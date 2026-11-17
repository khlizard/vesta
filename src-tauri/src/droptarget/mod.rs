//! The window's drop target. Spec: docs/spec/fileops.md
//!
//! Takes files (CF_HDROP), virtual files that carry their contents (FileGroupDescriptorW +
//! FileContents: images and links from browsers, mail attachments) and bare URLs. It replaces the
//! handler Tauri registers, which takes CF_HDROP only and refuses everything else.
//!
//! The frontend gets `drag-drop` events (enter / over / drop / leave) with the position and
//! decides where the drop goes. Data without paths is written to a temporary folder inside `Drop`
//! (the data object is only valid there) and the frontend moves the files to their destination.

mod names;

use std::cell::{Cell, RefCell};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Foundation::{DRAGDROP_E_INVALIDHWND, HWND, LPARAM, POINT, POINTL};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::System::Com::{IDataObject, STREAM_SEEK_SET, TYMED_HGLOBAL, TYMED_ISTREAM};
use windows::Win32::System::Ole::{
    DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_NONE, IDropTarget, IDropTarget_Impl,
    RegisterDragDrop, RevokeDragDrop,
};
use windows::Win32::System::SystemServices::{MK_RBUTTON, MODIFIERKEYS_FLAGS};
use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;
use windows::core::{BOOL, Ref, implement, w};

use crate::com;
use crate::dataobject::{Medium, format_id, formatetc, global_data, hdrop_paths};
use names::{VirtualFile, descriptor_files, distinct_names, safe_name, url_shortcut, wide_text};

const EVENT: &str = "drag-drop";
const TEMP_FOLDER: &str = "vesta-drop";

// ---------------------------------------------------------------- data object (COM)

fn descriptor_format() -> u16 {
    format_id(w!("FileGroupDescriptorW"))
}

fn contents_format() -> u16 {
    format_id(w!("FileContents"))
}

fn url_format() -> u16 {
    format_id(w!("UniformResourceLocatorW"))
}

/// The virtual files of `data` with their index in the descriptor. Folders are left out, so files
/// inside them land flat: browsers and mail clients send flat lists.
fn virtual_files(data: &IDataObject) -> Vec<(usize, VirtualFile)> {
    let bytes = global_data(data, descriptor_format()).unwrap_or_default();
    descriptor_files(&bytes).into_iter().enumerate().filter(|(_, f)| !f.directory).collect()
}

/// The Internet shortcut (name, contents) for the URL of `data`.
fn url_of(data: &IDataObject) -> Option<(String, String)> {
    url_shortcut(&wide_text(&global_data(data, url_format()).ok()?))
}

/// What a drag carries, in the order the spec lists.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    None,
    Files,
    Virtual,
    Url,
}

/// Looks at the data itself: some data objects say yes to any format when only asked.
fn kind_of(data: &IDataObject) -> Kind {
    if !hdrop_paths(data).is_empty() {
        Kind::Files
    } else if !virtual_files(data).is_empty() {
        Kind::Virtual
    } else if url_of(data).is_some() {
        Kind::Url
    } else {
        Kind::None
    }
}

/// Writes a medium (a stream or a memory block) to `out`.
fn write_medium(medium: &Medium, size: Option<u64>, out: &mut impl Write) -> Result<(), String> {
    if let Some(stream) = medium.stream() {
        unsafe {
            // Some sources hand the stream over positioned at its end.
            let _ = stream.Seek(0, STREAM_SEEK_SET, None);
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                let mut read = 0u32;
                let hr = stream.Read(buf.as_mut_ptr() as *mut _, buf.len() as u32, Some(&mut read));
                if hr.is_err() {
                    return Err(com::err(hr.into()));
                }
                // No more than what was asked for, whatever the source says.
                let Some(chunk) = buf.get(..read as usize).filter(|c| !c.is_empty()) else {
                    return Ok(());
                };
                out.write_all(chunk).map_err(|e| e.to_string())?;
            }
        }
    } else if let Some(bytes) = medium.bytes(size) {
        out.write_all(&bytes?).map_err(|e| e.to_string())
    } else {
        Err("unsupported data".to_string())
    }
}

/// Writes the virtual files of `data` into `dir`. Returns the files written.
fn save_virtual(data: &IDataObject, dir: &Path) -> Result<Vec<PathBuf>, String> {
    let files = virtual_files(data);
    if files.is_empty() {
        return Err("no files in the dropped data".into());
    }
    let names = distinct_names(files.iter().map(|(_, f)| safe_name(&f.name)).collect());
    let tymed = (TYMED_ISTREAM.0 | TYMED_HGLOBAL.0) as u32;
    let mut written = Vec::new();
    for ((index, file), name) in files.iter().zip(names) {
        let medium = Medium::get(data, &formatetc(contents_format(), *index as i32, tymed))
            .map_err(|e| format!("{name}: {}", com::err(e)))?;
        let path = dir.join(&name);
        let mut out = std::fs::File::create(&path).map_err(|e| format!("{name}: {e}"))?;
        write_medium(&medium, file.size, &mut out).map_err(|e| format!("{name}: {e}"))?;
        written.push(path);
    }
    Ok(written)
}

/// Writes an Internet shortcut for the URL of `data` into `dir`.
fn save_url(data: &IDataObject, dir: &Path) -> Result<Vec<PathBuf>, String> {
    let (name, text) = url_of(data).ok_or("not a web address")?;
    let path = dir.join(name);
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(vec![path])
}

fn temp_root() -> PathBuf {
    std::env::temp_dir().join(TEMP_FOLDER)
}

/// A new, empty folder for the files of one drop.
fn new_drop_dir() -> Result<PathBuf, String> {
    static SEQ: AtomicU32 = AtomicU32::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let dir = temp_root().join(format!("{}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Saves what a drag without paths carries: `write` puts it into the temporary folder it is
/// given. Returns the files written.
fn save(write: impl FnOnce(&Path) -> Result<Vec<PathBuf>, String>) -> Result<Vec<String>, String> {
    let dir = new_drop_dir()?;
    match write(&dir) {
        Ok(files) => Ok(files.iter().map(|p| p.to_string_lossy().into_owned()).collect()),
        Err(e) => {
            let _ = std::fs::remove_dir_all(&dir);
            Err(e)
        }
    }
}

// ---------------------------------------------------------------- drop target

#[derive(Serialize, Clone)]
struct Position {
    x: f64,
    y: f64,
}

/// Payload of the `drag-drop` event. `saving`: the drag has no paths; its data is saved on drop,
/// and the dropped `paths` are then temporary files to move to the destination.
#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
enum DragEvent {
    Enter { paths: Vec<String>, position: Position, saving: bool },
    Over { position: Position },
    Drop {
        paths: Vec<String>,
        position: Position,
        saving: bool,
        /// Dragged with the right button: the frontend asks what to do.
        #[serde(rename = "rightButton")]
        right_button: bool,
        error: Option<String>,
    },
    Leave,
}

#[implement(IDropTarget)]
struct Target {
    hwnd: HWND,
    app: AppHandle,
    kind: Cell<Kind>,
    effect: Cell<DROPEFFECT>,
    /// The drag is held with the right button (known while dragging; released by the time of Drop).
    right: Cell<bool>,
}

impl Target {
    /// Position in physical pixels inside the webview (the frontend divides by the scale factor).
    fn position(&self, pt: &POINTL) -> Position {
        let mut p = POINT { x: pt.x, y: pt.y };
        let _ = unsafe { ScreenToClient(self.hwnd, &mut p) };
        Position { x: p.x as f64, y: p.y as f64 }
    }

    fn emit(&self, event: DragEvent) {
        let _ = self.app.emit(EVENT, event);
    }
}

#[allow(non_snake_case)]
impl IDropTarget_Impl for Target_Impl {
    fn DragEnter(
        &self,
        data: Ref<'_, IDataObject>,
        keys: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        self.right.set(keys.0 & MK_RBUTTON.0 != 0);
        let allowed = if effect.is_null() { DROPEFFECT_NONE } else { unsafe { *effect } };
        let mut kind = data.as_ref().map_or(Kind::None, kind_of);
        let chosen = match kind {
            Kind::None => DROPEFFECT_NONE,
            // Whether files are copied or moved is decided by the frontend when they are dropped.
            Kind::Files => DROPEFFECT_COPY,
            // Never MOVE: the source would delete what it handed over.
            Kind::Virtual | Kind::Url if allowed.0 & DROPEFFECT_COPY.0 != 0 => DROPEFFECT_COPY,
            Kind::Virtual | Kind::Url if allowed.0 & DROPEFFECT_LINK.0 != 0 => DROPEFFECT_LINK,
            Kind::Virtual | Kind::Url => DROPEFFECT_NONE,
        };
        if chosen == DROPEFFECT_NONE {
            kind = Kind::None;
        }
        self.kind.set(kind);
        self.effect.set(chosen);
        if !effect.is_null() {
            unsafe { *effect = chosen };
        }
        if kind != Kind::None {
            let paths = match (kind, data.as_ref()) {
                (Kind::Files, Some(data)) => hdrop_paths(data),
                _ => Vec::new(),
            };
            self.emit(DragEvent::Enter { paths, position: self.position(pt), saving: kind != Kind::Files });
        }
        Ok(())
    }

    fn DragOver(&self, keys: MODIFIERKEYS_FLAGS, pt: &POINTL, effect: *mut DROPEFFECT) -> windows::core::Result<()> {
        self.right.set(keys.0 & MK_RBUTTON.0 != 0);
        if self.kind.get() != Kind::None {
            self.emit(DragEvent::Over { position: self.position(pt) });
        }
        if !effect.is_null() {
            unsafe { *effect = self.effect.get() };
        }
        Ok(())
    }

    fn DragLeave(&self) -> windows::core::Result<()> {
        if self.kind.replace(Kind::None) != Kind::None {
            self.emit(DragEvent::Leave);
        }
        Ok(())
    }

    fn Drop(
        &self,
        data: Ref<'_, IDataObject>,
        _keys: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let kind = self.kind.replace(Kind::None);
        if !effect.is_null() {
            unsafe { *effect = self.effect.get() };
        }
        let Some(data) = data.as_ref() else { return Ok(()) };
        let saved = match kind {
            Kind::None => return Ok(()),
            Kind::Files => Ok(hdrop_paths(data)),
            Kind::Virtual => save(|dir| save_virtual(data, dir)),
            Kind::Url => save(|dir| save_url(data, dir)),
        };
        let (paths, error) = match saved {
            Ok(paths) => (paths, None),
            Err(e) => (Vec::new(), Some(e)),
        };
        self.emit(DragEvent::Drop {
            paths,
            position: self.position(pt),
            saving: kind != Kind::Files,
            right_button: self.right.get(),
            error,
        });
        Ok(())
    }
}

thread_local! {
    /// Keeps the registered targets alive for the life of the window (main thread only).
    static TARGETS: RefCell<Vec<IDropTarget>> = const { RefCell::new(Vec::new()) };
}

unsafe extern "system" fn collect_child(hwnd: HWND, lparam: LPARAM) -> BOOL {
    unsafe { (*(lparam.0 as *mut Vec<HWND>)).push(hwnd) };
    true.into()
}

/// Registers the drop target on the webview's windows, in place of the one Tauri registered.
/// Call on the main thread, after the webview exists.
pub fn install(window: &tauri::WebviewWindow) -> Result<(), String> {
    // Files of earlier drops that were never moved to their destination.
    std::thread::spawn(|| {
        let _ = std::fs::remove_dir_all(temp_root());
    });

    let top = com::hwnd_of(window)?;
    let app = window.app_handle().clone();
    let mut children: Vec<HWND> = Vec::new();
    let _ = unsafe { EnumChildWindows(Some(top), Some(collect_child), LPARAM(&mut children as *mut _ as isize)) };
    let mut registered = Vec::new();
    for hwnd in children {
        let target: IDropTarget =
            Target {
            hwnd,
            app: app.clone(),
            kind: Cell::new(Kind::None),
            effect: Cell::new(DROPEFFECT_NONE),
            right: Cell::new(false),
        }
        .into();
        let revoked = unsafe { RevokeDragDrop(hwnd) };
        if revoked != Err(DRAGDROP_E_INVALIDHWND.into()) && unsafe { RegisterDragDrop(hwnd, &target) }.is_ok() {
            registered.push(target);
        }
    }
    if registered.is_empty() {
        return Err("no window to register the drop target on".into());
    }
    TARGETS.with(|t| *t.borrow_mut() = registered);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dataobject::{global, set_global};
    use names::descriptor;
    use windows::Win32::UI::Shell::SHCreateDataObject;

    fn empty_data_object() -> IDataObject {
        com::init_sta();
        unsafe { SHCreateDataObject(None, None, None).unwrap() }
    }

    #[test]
    fn virtual_files_are_saved_with_safe_names() {
        let data = empty_data_object();
        assert_eq!(kind_of(&data), Kind::None);
        // One file only: the Shell's data object keeps a single FileContents, whatever its index.
        // The memory block is larger than the file; the size in the descriptor cuts it.
        let files = descriptor(&[(r"..\picture.png", 0x40, 0, 5)]);
        set_global(&data, &global(descriptor_format()), &files).unwrap();
        set_global(&data, &formatetc(contents_format(), 0, TYMED_HGLOBAL.0 as u32), b"12345+padding").unwrap();
        assert_eq!(kind_of(&data), Kind::Virtual);

        let dir = tempfile::tempdir().unwrap();
        let written = save_virtual(&data, dir.path()).unwrap();
        assert_eq!(written, vec![dir.path().join("picture.png")]);
        assert_eq!(std::fs::read(&written[0]).unwrap(), b"12345");
    }

    #[test]
    fn a_url_is_saved_as_an_internet_shortcut() {
        let data = empty_data_object();
        let wide: Vec<u8> = "https://example.com/page\0".encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
        set_global(&data, &global(url_format()), &wide).unwrap();
        assert_eq!(kind_of(&data), Kind::Url);

        let dir = tempfile::tempdir().unwrap();
        let written = save_url(&data, dir.path()).unwrap();
        assert_eq!(written, vec![dir.path().join("example.com.url")]);
        assert_eq!(std::fs::read_to_string(&written[0]).unwrap(), "[InternetShortcut]\r\nURL=https://example.com/page\r\n");
    }
}
