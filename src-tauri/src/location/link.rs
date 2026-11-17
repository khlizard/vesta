//! Following shortcuts (.lnk) to folders, also when the stored target has moved.

use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance, IPersistFile, STGM_READ};
use windows::Win32::UI::Shell::{
    BHID_LinkTargetItem, IShellItem, IShellLinkW, SIGDN_FILESYSPATH, SLR_NO_UI, SLR_NOUPDATE, ShellLink,
};
use windows::core::{Interface, PCWSTR};

use super::item::{is_filesystem, is_folder, item_for};
use super::info_from_item;
use crate::com::{from_wide_buf, item_name, wide};
use crate::types::FolderInfo;

/// The folder a shortcut (.lnk) points to; `None` when `location` is not a shortcut, or its
/// target is a file or cannot be found. Spec: docs/spec/navigation.md「ファイルを開く」
pub fn link_folder(location: &str) -> Option<FolderInfo> {
    let item = item_for(location).ok()?;
    let stored: Option<IShellItem> =
        unsafe { item.BindToHandler(None::<&windows::Win32::System::Com::IBindCtx>, &BHID_LinkTargetItem) }.ok();
    // The stored item is built from the shortcut's own data, without looking at the disk: it
    // can name a place that is gone (the folder was moved, the drive letter changed, the
    // shortcut was made on another PC). Then look for the target like the Shell does.
    let gone = |t: &IShellItem| {
        is_filesystem(t) && item_name(t, SIGDN_FILESYSPATH).is_ok_and(|p| !std::path::Path::new(&p).exists())
    };
    let target = match stored {
        Some(t) if !gone(&t) => t,
        _ => item_for(&moved_link_target(location)?).ok()?,
    };
    if is_folder(&target) { info_from_item(&target).ok() } else { None }
}

/// How long the Shell may look for a moved shortcut target.
const LINK_RESOLVE_MS: u32 = 1000;

/// An existing place for the shortcut file `lnk` whose stored target is gone: what the Shell
/// finds (link tracking), else the target's position relative to the shortcut. No dialog is
/// shown and the shortcut file is not rewritten.
fn moved_link_target(lnk: &str) -> Option<String> {
    let exists = |p: &String| std::path::Path::new(p).exists();
    shell_resolved_link(lnk).filter(exists).or_else(|| {
        let rel = lnk_relative_path(&std::fs::read(lnk).ok()?)?;
        let dir = &lnk[..lnk.rfind('\\')?];
        Some(join_relative(dir, &rel)).filter(exists)
    })
}

fn shell_resolved_link(lnk: &str) -> Option<String> {
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        let file: IPersistFile = link.cast().ok()?;
        file.Load(PCWSTR(wide(lnk).as_ptr()), STGM_READ).ok()?;
        // With SLR_NO_UI the high word of the flags is the time limit in milliseconds.
        let flags = (SLR_NO_UI.0 | SLR_NOUPDATE.0) as u32 | (LINK_RESOLVE_MS << 16);
        link.Resolve(windows::Win32::Foundation::HWND::default(), flags).ok()?;
        let mut buf = [0u16; 1024];
        link.GetPath(&mut buf, std::ptr::null_mut(), 0).ok()?;
        let path = from_wide_buf(&buf);
        if path.is_empty() { None } else { Some(path) }
    }
}

/// The relative path stored in a shortcut file (`..\target`), from its bytes ([MS-SHLLINK]:
/// header, optional item list and link info, then the strings named by the header flags).
fn lnk_relative_path(data: &[u8]) -> Option<String> {
    const HEADER: usize = 0x4C;
    const HAS_ID_LIST: u32 = 0x01;
    const HAS_LINK_INFO: u32 = 0x02;
    const HAS_NAME: u32 = 0x04;
    const HAS_RELATIVE_PATH: u32 = 0x08;
    const IS_UNICODE: u32 = 0x80;
    let u16_at = |i: usize| Some(u16::from_le_bytes(data.get(i..i + 2)?.try_into().ok()?) as usize);
    let u32_at = |i: usize| Some(u32::from_le_bytes(data.get(i..i + 4)?.try_into().ok()?));
    if u32_at(0)? as usize != HEADER {
        return None;
    }
    let flags = u32_at(0x14)?;
    if flags & HAS_RELATIVE_PATH == 0 {
        return None;
    }
    let mut at = HEADER;
    if flags & HAS_ID_LIST != 0 {
        at += 2 + u16_at(at)?;
    }
    if flags & HAS_LINK_INFO != 0 {
        at += u32_at(at)? as usize;
    }
    let unit = if flags & IS_UNICODE != 0 { 2 } else { 1 };
    if flags & HAS_NAME != 0 {
        at += 2 + u16_at(at)? * unit;
    }
    let bytes = data.get(at + 2..at + 2 + u16_at(at)? * unit)?;
    if unit == 2 {
        let units: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
        Some(String::from_utf16_lossy(&units))
    } else {
        // Shortcuts written without the Unicode flag are rare; plain ASCII is enough for them.
        bytes.is_ascii().then(|| String::from_utf8_lossy(bytes).into_owned())
    }
}

/// `dir` followed by the relative path `rel`, with `.` and `..` worked out (`..` stops at the root).
fn join_relative(dir: &str, rel: &str) -> String {
    let mut parts: Vec<&str> = dir.trim_end_matches('\\').split('\\').collect();
    for p in rel.split(['\\', '/']) {
        match p {
            "" | "." => {}
            ".." => {
                if parts.len() > 1 {
                    parts.pop();
                }
            }
            name => parts.push(name),
        }
    }
    parts.join("\\")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::location::long_path;

    /// Prints where a real shortcut leads: set VESTA_TEST_LNK and run with --ignored.
    #[test]
    #[ignore]
    fn link_folder_of_real_shortcut() {
        let Ok(path) = std::env::var("VESTA_TEST_LNK") else { return };
        crate::com::init_sta();
        println!("link_folder({path}) = {:?}", link_folder(&path).map(|f| f.location));
    }

    /// A shortcut file with the given flags and strings, as [MS-SHLLINK] lays them out.
    fn lnk_bytes(flags: u32, id_list: Option<&[u8]>, link_info: Option<&[u8]>, strings: &[&str]) -> Vec<u8> {
        let mut d = vec![0u8; 0x4C];
        d[0..4].copy_from_slice(&0x4Cu32.to_le_bytes());
        d[0x14..0x18].copy_from_slice(&flags.to_le_bytes());
        if let Some(ids) = id_list {
            d.extend((ids.len() as u16).to_le_bytes());
            d.extend(ids);
        }
        if let Some(info) = link_info {
            d.extend((info.len() as u32 + 4).to_le_bytes());
            d.extend(info);
        }
        for s in strings {
            let units: Vec<u16> = s.encode_utf16().collect();
            d.extend((units.len() as u16).to_le_bytes());
            d.extend(units.iter().flat_map(|u| u.to_le_bytes()));
        }
        d
    }

    #[test]
    fn lnk_relative_path_is_read_from_the_file() {
        // Item list, link info, a name, then the relative path (Unicode).
        let d = lnk_bytes(0x8F, Some(&[1, 2, 3, 4, 0, 0]), Some(&[9; 20]), &["説明", r"..\_DJ"]);
        assert_eq!(lnk_relative_path(&d).as_deref(), Some(r"..\_DJ"));
        // Only the relative path.
        let d = lnk_bytes(0x88, None, None, &[r".\フォルダ"]);
        assert_eq!(lnk_relative_path(&d).as_deref(), Some(r".\フォルダ"));
        // No relative path, a cut-off file, not a shortcut.
        assert_eq!(lnk_relative_path(&lnk_bytes(0x84, None, None, &["name"])), None);
        let d = lnk_bytes(0x88, None, None, &[r"..\x"]);
        assert_eq!(lnk_relative_path(&d[..d.len() - 1]), None);
        assert_eq!(lnk_relative_path(b"not a shortcut"), None);
    }

    #[test]
    fn join_relative_works_out_dots() {
        assert_eq!(join_relative(r"D:\a\b", r"..\c"), r"D:\a\c");
        assert_eq!(join_relative(r"D:\a\b\", r".\c\d"), r"D:\a\b\c\d");
        assert_eq!(join_relative(r"D:\a", r"..\..\..\c"), r"D:\c");
    }

    #[test]
    fn link_folder_follows_shortcuts_to_folders_only() {
        crate::com::init_sta();
        let dir = tempfile::tempdir().unwrap();
        // The shell answers with long names; TEMP may be a short one (RUNNER~1 on CI).
        let root = long_path(dir.path());
        let target = root.join("target");
        std::fs::create_dir(&target).unwrap();
        let file = root.join("a.txt");
        std::fs::write(&file, b"x").unwrap();
        let make = |name: &str, to: &std::path::Path| {
            let lnk = root.join(name);
            let script = format!(
                "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');$s.TargetPath='{}';$s.Save()",
                lnk.display(),
                to.display()
            );
            let ok = std::process::Command::new("powershell")
                .args(["-NoProfile", "-Command", &script])
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            (lnk, ok)
        };
        let (to_dir, ok1) = make("d.lnk", &target);
        let (to_file, ok2) = make("f.lnk", &file);
        if !ok1 || !ok2 {
            return; // no PowerShell to create shortcuts with
        }
        let got = link_folder(&to_dir.to_string_lossy()).expect("folder shortcut");
        assert!(got.location.eq_ignore_ascii_case(&target.to_string_lossy()));
        assert!(link_folder(&to_file.to_string_lossy()).is_none());
        assert!(link_folder(&file.to_string_lossy()).is_none());

        // The folder holding both the shortcut and its target is renamed: the stored path is
        // stale, the target is found again from the shortcut's own place.
        let moved = root.with_file_name(format!("{}-moved", root.file_name().unwrap().to_string_lossy()));
        std::fs::rename(&root, &moved).unwrap();
        let got = link_folder(&moved.join("d.lnk").to_string_lossy());
        std::fs::rename(&moved, &root).unwrap(); // back, so the temporary folder is cleaned up
        let got = got.expect("moved folder shortcut");
        assert!(got.location.eq_ignore_ascii_case(&moved.join("target").to_string_lossy()));
    }
}
