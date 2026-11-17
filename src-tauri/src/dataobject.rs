//! Building and reading Shell data objects: paths -> PIDLs -> IShellItemArray -> IDataObject,
//! CF_HDROP, memory blocks (HGLOBAL) and the formats that describe them.
//! Shared by the clipboard, dragging out, the drop target and file operations.

use std::mem::ManuallyDrop;

use windows::Win32::Foundation::{GlobalFree, HGLOBAL};
use windows::Win32::System::Com::{
    DVASPECT_CONTENT, FORMATETC, IBindCtx, IDataObject, IStream, STGMEDIUM, STGMEDIUM_0, TYMED_HGLOBAL,
    TYMED_ISTREAM,
};
use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
use windows::Win32::System::Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock};
use windows::Win32::System::Ole::{CF_HDROP, ReleaseStgMedium};
use windows::Win32::UI::Shell::{
    BHID_DataObject, DragQueryFileW, HDROP, IShellItemArray, SHCreateShellItemArrayFromIDLists,
};
use windows::core::{PCWSTR, w};

use crate::com::{Pidl, err};

// ---------------------------------------------------------------- paths -> items -> data object

/// Why a list of paths did not become Shell items. The callers word it differently (and did so
/// before this module existed), so the wording is theirs: see [`ItemsError::with_path`] and
/// [`ItemsError::plain`].
#[derive(Debug)]
pub enum ItemsError {
    /// The list was empty.
    Empty,
    /// The Shell could not parse `path`.
    Parse { path: String, message: String },
    /// Any other Shell failure.
    Shell(String),
}

impl ItemsError {
    /// `empty` for an empty list; a path that cannot be parsed is named: `path: message`.
    pub fn with_path(self, empty: &str) -> String {
        match self {
            Self::Empty => empty.to_string(),
            Self::Parse { path, message } => format!("{path}: {message}"),
            Self::Shell(message) => message,
        }
    }

    /// `empty` for an empty list; otherwise the Shell's message alone.
    pub fn plain(self, empty: &str) -> String {
        match self {
            Self::Empty => empty.to_string(),
            Self::Parse { message, .. } | Self::Shell(message) => message,
        }
    }
}

/// The absolute PIDL of every path, in order.
pub fn pidls(paths: &[String]) -> Result<Vec<Pidl>, ItemsError> {
    paths
        .iter()
        .map(|p| {
            Pidl::from_parsing(p).map_err(|e| ItemsError::Parse { path: p.clone(), message: err(e) })
        })
        .collect()
}

/// The Shell item array of `paths` (file system paths or parsing names).
pub fn item_array(paths: &[String]) -> Result<IShellItemArray, ItemsError> {
    if paths.is_empty() {
        return Err(ItemsError::Empty);
    }
    let pidls = pidls(paths)?;
    let ptrs: Vec<_> = pidls.iter().map(Pidl::as_ptr).collect();
    // The array keeps its own copies of the PIDLs.
    unsafe { SHCreateShellItemArrayFromIDLists(&ptrs) }.map_err(|e| ItemsError::Shell(err(e)))
}

/// The Shell data object (CF_HDROP, Shell IDList array, drag image support) of `paths`.
pub fn data_object(paths: &[String]) -> Result<IDataObject, ItemsError> {
    let array = item_array(paths)?;
    unsafe { array.BindToHandler::<_, IDataObject>(None::<&IBindCtx>, &BHID_DataObject) }
        .map_err(|e| ItemsError::Shell(err(e)))
}

// ---------------------------------------------------------------- formats

/// The id of a named clipboard format.
pub fn format_id(name: PCWSTR) -> u16 {
    unsafe { RegisterClipboardFormatW(name) as u16 }
}

/// "Preferred DropEffect": whether files on the clipboard were copied or cut.
pub fn preferred_drop_effect() -> u16 {
    format_id(w!("Preferred DropEffect"))
}

pub fn formatetc(format: u16, index: i32, tymed: u32) -> FORMATETC {
    FORMATETC {
        cfFormat: format,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: index,
        tymed,
    }
}

/// A whole format handed over as a memory block.
pub fn global(format: u16) -> FORMATETC {
    formatetc(format, -1, TYMED_HGLOBAL.0 as u32)
}

// ---------------------------------------------------------------- memory blocks

/// A moveable memory block that is ours to free until it is handed over (`into_raw`).
pub struct Global(HGLOBAL);

impl Global {
    /// A new block holding a copy of `data`.
    pub fn copy_of<T: Copy>(data: &[T]) -> Result<Self, String> {
        let bytes = std::mem::size_of_val(data);
        unsafe {
            // Freed by `Drop` on every way out from here.
            let block = Self(GlobalAlloc(GMEM_MOVEABLE, bytes.max(1)).map_err(err)?);
            let p = GlobalLock(block.0) as *mut u8;
            if p.is_null() {
                return Err("GlobalLock failed".into());
            }
            std::ptr::copy_nonoverlapping(data.as_ptr() as *const u8, p, bytes);
            let _ = GlobalUnlock(block.0);
            Ok(block)
        }
    }

    pub fn handle(&self) -> HGLOBAL {
        self.0
    }

    /// Gives the block up: whoever took the handle frees it.
    pub fn into_raw(self) -> HGLOBAL {
        ManuallyDrop::new(self).0
    }
}

impl Drop for Global {
    fn drop(&mut self) {
        unsafe {
            let _ = GlobalFree(Some(self.0));
        }
    }
}

/// A copy of the bytes of `handle` (at most `limit` of them). The block stays its owner's.
fn bytes_of(handle: HGLOBAL, limit: Option<u64>) -> Result<Vec<u8>, String> {
    unsafe {
        let size = GlobalSize(handle);
        let p = GlobalLock(handle) as *const u8;
        if p.is_null() {
            return Err("GlobalLock failed".into());
        }
        let len = limit.map_or(size, |l| size.min(l as usize));
        let bytes = std::slice::from_raw_parts(p, len).to_vec();
        let _ = GlobalUnlock(handle);
        Ok(bytes)
    }
}

// ---------------------------------------------------------------- storage media

/// A storage medium got from a data object; released when dropped.
pub struct Medium(STGMEDIUM);

impl Medium {
    pub fn get(data: &IDataObject, format: &FORMATETC) -> windows::core::Result<Self> {
        unsafe { data.GetData(format) }.map(Self)
    }

    fn is(&self, tymed: windows::Win32::System::Com::TYMED) -> bool {
        self.0.tymed == tymed.0 as u32
    }

    /// The memory block, when the medium is one.
    fn hglobal(&self) -> Option<HGLOBAL> {
        // The union is read only as what `tymed` says it holds.
        if self.is(TYMED_HGLOBAL) { Some(unsafe { self.0.u.hGlobal }) } else { None }
    }

    /// The stream, when the medium is one.
    pub fn stream(&self) -> Option<&IStream> {
        if !self.is(TYMED_ISTREAM) {
            return None;
        }
        unsafe { (*self.0.u.pstm).as_ref() }
    }

    /// The bytes of a memory block medium (at most `limit` of them); `None` for another kind.
    pub fn bytes(&self, limit: Option<u64>) -> Option<Result<Vec<u8>, String>> {
        self.hglobal().map(|h| bytes_of(h, limit))
    }

    /// The first four bytes of a memory block medium as a number (a drop effect).
    pub fn u32(&self) -> Option<u32> {
        let bytes = self.bytes(Some(4))?.ok()?;
        Some(u32::from_ne_bytes(bytes.try_into().ok()?))
    }

    /// The paths of a CF_HDROP medium.
    pub fn hdrop_paths(&self) -> Vec<String> {
        let Some(handle) = self.hglobal() else { return Vec::new() };
        let hdrop = HDROP(handle.0);
        unsafe {
            let count = DragQueryFileW(hdrop, u32::MAX, None);
            (0..count)
                .map(|i| {
                    let len = DragQueryFileW(hdrop, i, None) as usize;
                    let mut buf = vec![0u16; len + 1];
                    DragQueryFileW(hdrop, i, Some(&mut buf));
                    crate::com::from_wide_buf(&buf)
                })
                .collect()
        }
    }
}

impl Drop for Medium {
    fn drop(&mut self) {
        unsafe { ReleaseStgMedium(&mut self.0) };
    }
}

// ---------------------------------------------------------------- reading and writing formats

/// The format CF_HDROP as a memory block.
pub fn hdrop_format() -> FORMATETC {
    global(CF_HDROP.0)
}

/// The file paths `data` carries (CF_HDROP); empty when it has none.
pub fn hdrop_paths(data: &IDataObject) -> Vec<String> {
    Medium::get(data, &hdrop_format()).map(|m| m.hdrop_paths()).unwrap_or_default()
}

/// The bytes of a format handed over as a memory block.
pub fn global_data(data: &IDataObject, format: u16) -> Result<Vec<u8>, String> {
    let medium = Medium::get(data, &global(format)).map_err(err)?;
    medium.bytes(None).unwrap_or_else(|| Err("unsupported data".into()))
}

/// Stores `bytes` in `data` as `format`, in a memory block the data object then owns.
pub fn set_global(data: &IDataObject, format: &FORMATETC, bytes: &[u8]) -> Result<(), String> {
    let block = Global::copy_of(bytes)?;
    let medium = STGMEDIUM {
        tymed: TYMED_HGLOBAL.0 as u32,
        u: STGMEDIUM_0 { hGlobal: block.handle() },
        pUnkForRelease: ManuallyDrop::new(None),
    };
    // fRelease = true: the data object owns the block once the call has succeeded. When it
    // fails the block is still ours to free (`block` is dropped).
    unsafe { data.SetData(format, &medium, true) }.map_err(err)?;
    let _ = block.into_raw();
    Ok(())
}

/// Stores a number (a drop effect) in `data` as `format`.
pub fn set_u32(data: &IDataObject, format: u16, value: u32) -> Result<(), String> {
    set_global(data, &global(format), &value.to_ne_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::Shell::SHCreateDataObject;

    #[test]
    fn data_object_exposes_hdrop() {
        crate::com::init_sta();
        let dir = tempfile::tempdir().unwrap();
        // The shell answers with long names; TEMP may be a short one (RUNNER~1 on CI).
        let root = crate::location::long_path(dir.path());
        let a = root.join("a.txt");
        let b = root.join("b.txt");
        std::fs::write(&a, b"a").unwrap();
        std::fs::write(&b, b"b").unwrap();
        let locs = vec![a.to_string_lossy().to_string(), b.to_string_lossy().to_string()];
        let data = data_object(&locs).unwrap();
        assert!(unsafe { data.QueryGetData(&hdrop_format()) }.is_ok());
        let got: Vec<String> = hdrop_paths(&data).iter().map(|p| p.to_lowercase()).collect();
        assert_eq!(got.len(), 2);
        assert!(got.contains(&locs[0].to_lowercase()));
        assert!(got.contains(&locs[1].to_lowercase()));
    }

    #[test]
    fn items_errors_keep_the_callers_wording() {
        crate::com::init_sta();
        let none: [String; 0] = [];
        assert_eq!(item_array(&none).unwrap_err().with_path("対象がありません"), "対象がありません");
        assert_eq!(data_object(&none).map(|_| ()).unwrap_err().plain("no items to drag"), "no items to drag");
        let missing = r"C:\no-such-dir-vesta-test\nofile.txt".to_string();
        let named = item_array(std::slice::from_ref(&missing)).unwrap_err().with_path("-");
        assert!(named.starts_with(&format!("{missing}: ")), "{named}");
        let plain = pidls(std::slice::from_ref(&missing)).map(|_| ()).unwrap_err().plain("-");
        assert!(!plain.contains(&missing), "{plain}");
        assert_eq!(named, format!("{missing}: {plain}"));
    }

    #[test]
    fn numbers_and_bytes_round_trip_through_a_data_object() {
        crate::com::init_sta();
        let data: IDataObject = unsafe { SHCreateDataObject(None, None, None).unwrap() };
        let effect = preferred_drop_effect();
        assert!(Medium::get(&data, &global(effect)).is_err());
        set_u32(&data, effect, 2).unwrap();
        assert_eq!(Medium::get(&data, &global(effect)).unwrap().u32(), Some(2));

        let format = format_id(w!("VestaTestBytes"));
        set_global(&data, &global(format), b"12345").unwrap();
        // A memory block may be larger than what was asked for; the limit cuts it.
        let all = global_data(&data, format).unwrap();
        assert!(all.starts_with(b"12345"));
        let medium = Medium::get(&data, &global(format)).unwrap();
        assert_eq!(medium.bytes(Some(3)).unwrap().unwrap(), b"123");
        assert!(medium.stream().is_none());
    }
}
