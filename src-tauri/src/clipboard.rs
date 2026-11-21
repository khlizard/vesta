//! File and text clipboard (CF_HDROP + Preferred DropEffect, CF_UNICODETEXT).
//! Everything runs on `crate::com::clip_pool()`: one thread of its own, so the clipboard answers
//! while a file operation runs.

use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::DataExchange::{EmptyClipboard, SetClipboardData};
use windows::Win32::System::Ole::{
    CF_HDROP, CF_UNICODETEXT, DROPEFFECT_COPY, DROPEFFECT_MOVE, OleGetClipboard,
};
use windows::core::w;

use crate::com::{self, OpenClipboardGuard, err};
use crate::dataobject::{self, Global, Medium};
use crate::types::ClipFiles;

pub async fn set_files(paths: Vec<String>, cut: bool) -> Result<(), String> {
    com::clip_pool().run(move || set_files_sync(&paths, cut)).await?
}

pub async fn get_files() -> Result<Option<ClipFiles>, String> {
    com::clip_pool().run(get_files_sync).await?
}

pub async fn set_text(text: String) -> Result<(), String> {
    com::clip_pool().run(move || set_text_sync(&text)).await?
}

/// Empties the clipboard (after pasting cut files: they are no longer where it says).
pub async fn clear() -> Result<(), String> {
    com::clip_pool().run(clear_sync).await?
}

fn clear_sync() -> Result<(), String> {
    let _open = OpenClipboardGuard::open()?;
    unsafe { EmptyClipboard() }.map_err(err)
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

/// Puts files on the clipboard as finished memory blocks: the file list (CF_HDROP), the Shell's
/// own list of the same items, and whether they were copied or cut.
///
/// Not through `OleSetClipboard`: that offers the data for later and only `OleFlushClipboard`
/// makes it real. In between, a program that watches the clipboard (the clipboard history of
/// Windows, a clipboard manager) asks for the data, and this thread, which runs no message
/// loop, cannot answer. The flush then fails or the other program gets nothing, and a paste in
/// Explorer does nothing.
fn set_files_sync(paths: &[String], cut: bool) -> Result<(), String> {
    let data = dataobject::data_object(paths).map_err(|e| e.with_path("no files"))?;
    let copy_of = |format: u16| -> Result<Global, String> {
        Global::copy_of(&dataobject::global_data(&data, format)?)
    };
    let files = copy_of(CF_HDROP.0)?;
    // Explorer pastes from CF_HDROP alone; the id list is what it prefers when it is there
    // (items without a file system path have nothing else).
    let id_list_format = dataobject::format_id(w!("Shell IDList Array"));
    let id_list = copy_of(id_list_format).ok();
    let effect = if cut { DROPEFFECT_MOVE } else { DROPEFFECT_COPY };
    let effect = Global::copy_of(&effect.0.to_ne_bytes())?;

    let _open = OpenClipboardGuard::open()?;
    unsafe { EmptyClipboard() }.map_err(err)?;
    put(CF_HDROP.0, files)?;
    if let Some(block) = id_list {
        put(id_list_format, block)?;
    }
    put(dataobject::preferred_drop_effect(), effect)
}

/// Hands `block` to the open clipboard as `format`.
fn put(format: u16, block: Global) -> Result<(), String> {
    // The clipboard owns the block once the call has succeeded. When it fails the block is
    // still ours to free (`block` is dropped).
    unsafe { SetClipboardData(format as u32, Some(HANDLE(block.handle().0))) }.map_err(err)?;
    let _ = block.into_raw();
    Ok(())
}

fn get_files_sync() -> Result<Option<ClipFiles>, String> {
    let data = retry_busy(|| unsafe { OleGetClipboard() }).map_err(err)?;
    let hdrop = dataobject::hdrop_format();
    if unsafe { data.QueryGetData(&hdrop) }.0 != 0 {
        return Ok(None);
    }
    let paths = retry_busy(|| Medium::get(&data, &hdrop)).map_err(err)?.hdrop_paths();
    let effect = dataobject::global(dataobject::preferred_drop_effect());
    let cut = retry_busy(|| Medium::get(&data, &effect))
        .ok()
        .and_then(|m| m.u32())
        .is_some_and(|e| e & DROPEFFECT_MOVE.0 != 0);
    Ok(Some(ClipFiles { paths, cut }))
}

fn set_text_sync(text: &str) -> Result<(), String> {
    let w = com::wide(text);
    let block = Global::copy_of(&w)?;
    let _open = OpenClipboardGuard::open()?;
    unsafe { EmptyClipboard() }.map_err(err)?;
    put(CF_UNICODETEXT.0, block)
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
        com::clip_pool()
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

    /// What another program sees: PowerShell reads the file list back from the clipboard.
    #[test]
    #[ignore]
    fn copied_files_can_be_read_by_another_process() {
        let dir = tempfile::tempdir().unwrap();
        let f = crate::location::long_path(dir.path()).join("あ b.txt");
        std::fs::write(&f, "x").unwrap();
        let path = f.to_str().unwrap().to_string();
        let copied = path.clone();
        com::clip_pool().run_blocking(move || set_files_sync(&[copied], false).unwrap()).unwrap();
        let out = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "[Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-Clipboard -Format FileDropList).FullName",
            ])
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
        assert!(text.contains(&path.to_lowercase()), "{text}");
    }

    #[test]
    #[ignore]
    fn text_clears_files() {
        com::clip_pool()
            .run_blocking(|| {
                set_text_sync("vesta テスト").unwrap();
                assert_eq!(get_files_sync().unwrap(), None);
            })
            .unwrap();
    }
}
