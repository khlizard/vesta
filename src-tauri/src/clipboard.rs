//! File and text clipboard (CF_HDROP + Preferred DropEffect, CF_UNICODETEXT).
//! Everything runs on `crate::com::op_pool()`.

use std::mem::ManuallyDrop;

use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
use windows::Win32::System::Com::{
    DVASPECT_CONTENT, FORMATETC, IBindCtx, IDataObject, STGMEDIUM, STGMEDIUM_0, TYMED_HGLOBAL,
};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{
    GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock,
};
use windows::Win32::System::Ole::{
    CF_HDROP, CF_UNICODETEXT, DROPEFFECT_COPY, DROPEFFECT_MOVE, OleFlushClipboard, OleGetClipboard,
    OleSetClipboard, ReleaseStgMedium,
};
use windows::Win32::UI::Shell::{
    BHID_DataObject, DragQueryFileW, HDROP, SHCreateShellItemArrayFromIDLists,
};
use windows::core::w;

use crate::com::{self, Pidl, err, from_wide_buf};
use crate::types::ClipFiles;

pub async fn set_files(paths: Vec<String>, cut: bool) -> Result<(), String> {
    com::op_pool().run(move || set_files_sync(&paths, cut)).await?
}

pub async fn get_files() -> Result<Option<ClipFiles>, String> {
    com::op_pool().run(get_files_sync).await?
}

pub async fn set_text(text: String) -> Result<(), String> {
    com::op_pool().run(move || set_text_sync(&text)).await?
}

/// Empties the clipboard (after pasting cut files: they are no longer where it says).
pub async fn clear() -> Result<(), String> {
    com::op_pool().run(clear_sync).await?
}

fn clear_sync() -> Result<(), String> {
    unsafe {
        open_clipboard()?;
        let result = EmptyClipboard().map_err(err);
        let _ = CloseClipboard();
        result
    }
}

fn formatetc(cf: u16) -> FORMATETC {
    FORMATETC {
        cfFormat: cf,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    }
}

fn drop_effect_format() -> u16 {
    unsafe { RegisterClipboardFormatW(w!("Preferred DropEffect")) as u16 }
}

/// Retries while another process holds the clipboard (CLIPBRD_E_CANT_OPEN).
fn retry_busy<T>(mut f: impl FnMut() -> windows::core::Result<T>) -> windows::core::Result<T> {
    let mut tries = 0;
    loop {
        match f() {
            Err(e) if e.code().0 == 0x800401D0u32 as i32 && tries < 20 => {
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            r => return r,
        }
    }
}

fn set_files_sync(paths: &[String], cut: bool) -> Result<(), String> {
    if paths.is_empty() {
        return Err("no files".into());
    }
    let pidls = paths
        .iter()
        .map(|p| Pidl::from_parsing(p).map_err(|e| format!("{p}: {}", err(e))))
        .collect::<Result<Vec<_>, _>>()?;
    let ptrs: Vec<_> = pidls.iter().map(|p| p.as_ptr()).collect();
    unsafe {
        let array = SHCreateShellItemArrayFromIDLists(&ptrs).map_err(err)?;
        let data: IDataObject = array
            .BindToHandler(None::<&IBindCtx>, &BHID_DataObject)
            .map_err(err)?;

        let effect = if cut { DROPEFFECT_MOVE } else { DROPEFFECT_COPY };
        let hg = GlobalAlloc(GMEM_MOVEABLE, 4).map_err(err)?;
        let p = GlobalLock(hg) as *mut u32;
        if p.is_null() {
            let _ = GlobalFree(Some(hg));
            return Err("GlobalLock failed".into());
        }
        *p = effect.0;
        let _ = GlobalUnlock(hg);
        let medium = STGMEDIUM {
            tymed: TYMED_HGLOBAL.0 as u32,
            u: STGMEDIUM_0 { hGlobal: hg },
            pUnkForRelease: ManuallyDrop::new(None),
        };
        // fRelease = true: the data object owns `hg` from here on.
        data.SetData(&formatetc(drop_effect_format()), &medium, true)
            .map_err(err)?;

        retry_busy(|| OleSetClipboard(&data)).map_err(err)?;
        retry_busy(|| OleFlushClipboard()).map_err(err)?;
    }
    Ok(())
}

fn get_files_sync() -> Result<Option<ClipFiles>, String> {
    unsafe {
        let data = retry_busy(|| OleGetClipboard()).map_err(err)?;
        let fmt = formatetc(CF_HDROP.0);
        if data.QueryGetData(&fmt).0 != 0 {
            return Ok(None);
        }
        let mut medium = retry_busy(|| data.GetData(&fmt)).map_err(err)?;
        let hdrop = HDROP(medium.u.hGlobal.0);
        let count = DragQueryFileW(hdrop, u32::MAX, None);
        let mut paths = Vec::with_capacity(count as usize);
        for i in 0..count {
            let len = DragQueryFileW(hdrop, i, None) as usize;
            let mut buf = vec![0u16; len + 1];
            DragQueryFileW(hdrop, i, Some(&mut buf));
            paths.push(from_wide_buf(&buf));
        }
        ReleaseStgMedium(&mut medium);

        let mut cut = false;
        if let Ok(mut m) = retry_busy(|| data.GetData(&formatetc(drop_effect_format()))) {
            let hg = m.u.hGlobal;
            let p = GlobalLock(hg) as *const u32;
            if !p.is_null() {
                cut = (*p & DROPEFFECT_MOVE.0) != 0;
                let _ = GlobalUnlock(hg);
            }
            ReleaseStgMedium(&mut m);
        }
        Ok(Some(ClipFiles { paths, cut }))
    }
}

/// OpenClipboard fails while another process holds it; retry briefly.
unsafe fn open_clipboard() -> Result<(), String> {
    let mut last = None;
    for _ in 0..20 {
        match unsafe { OpenClipboard(None) } {
            Ok(()) => return Ok(()),
            Err(e) => last = Some(e),
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    Err(last.map(err).unwrap_or_default())
}

fn set_text_sync(text: &str) -> Result<(), String> {
    let w = com::wide(text);
    let bytes = w.len() * 2;
    unsafe {
        open_clipboard()?;
        let result = (|| -> Result<(), String> {
            EmptyClipboard().map_err(err)?;
            let hg: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE, bytes).map_err(err)?;
            let p = GlobalLock(hg) as *mut u16;
            if p.is_null() {
                let _ = GlobalFree(Some(hg));
                return Err("GlobalLock failed".into());
            }
            std::ptr::copy_nonoverlapping(w.as_ptr(), p, w.len());
            let _ = GlobalUnlock(hg);
            if let Err(e) = SetClipboardData(CF_UNICODETEXT.0 as u32, Some(HANDLE(hg.0))) {
                let _ = GlobalFree(Some(hg));
                return Err(err(e));
            }
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // These tests overwrite the user's clipboard; run with `-- --ignored`.

    #[test]
    #[ignore]
    fn files_round_trip_copy_and_cut() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, "x").unwrap();
        let path = f.to_str().unwrap().to_string();
        com::op_pool()
            .run_blocking(move || {
                set_files_sync(std::slice::from_ref(&path), false).unwrap();
                let got = get_files_sync().unwrap().expect("hdrop");
                assert_eq!(got.paths.len(), 1);
                assert!(got.paths[0].eq_ignore_ascii_case(&path));
                assert!(!got.cut);

                set_files_sync(std::slice::from_ref(&path), true).unwrap();
                let got = get_files_sync().unwrap().expect("hdrop");
                assert!(got.cut);

                clear_sync().unwrap();
                assert_eq!(get_files_sync().unwrap(), None);
            })
            .unwrap();
    }

    #[test]
    #[ignore]
    fn text_clears_files() {
        com::op_pool()
            .run_blocking(|| {
                set_text_sync("avesta テスト").unwrap();
                assert_eq!(get_files_sync().unwrap(), None);
            })
            .unwrap();
    }
}
