//! Folder enumeration. Spec: docs/spec/listing.md. Runs on an STA thread.
//!
//! - `fs`: file-system folders via FindFirstFileExW (fast path).
//! - `shell`: virtual folders via IEnumShellItems.

mod fs;
mod shell;

use std::time::Instant;

use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
use windows::core::PCWSTR;

use crate::com::wide;
use crate::location;
use crate::types::{DiskFree, Listing};

/// Lists the items in `location`. Hidden/system items are skipped unless `show_hidden`.
pub fn list(location: &str, show_hidden: bool) -> Result<Listing, String> {
    let start = Instant::now();
    let item = location::item_for(location)?;
    let folder = location::info_from_item(&item)?;
    let entries = match folder.fs_path.as_deref() {
        Some(path) => fs::list_dir(path, show_hidden, folder.sync_root)?,
        None => shell::list_items(&item, show_hidden)?,
    };
    Ok(Listing { folder, entries, elapsed_ms: start.elapsed().as_millis() as u64 })
}

/// Drive letter or server name for a file-system location, `None` for virtual ones.
fn disk_label(location: &str) -> Option<String> {
    let b = location.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        return Some((b[0] as char).to_ascii_uppercase().to_string());
    }
    if let Some(rest) = location.strip_prefix("\\\\") {
        let mut parts = rest.split('\\').filter(|s| !s.is_empty());
        let server = parts.next()?;
        // `\\server` alone is the (virtual) list of shares.
        parts.next()?;
        return Some(server.to_string());
    }
    None
}

/// Free space for the volume that holds `location`. `None` for virtual folders.
pub fn disk_free(location: &str) -> Option<DiskFree> {
    let label = disk_label(location)?;
    let w = wide(location);
    let (mut free, mut total) = (0u64, 0u64);
    unsafe { GetDiskFreeSpaceExW(PCWSTR(w.as_ptr()), Some(&mut free), Some(&mut total), None) }
        .ok()?;
    Some(DiskFree { label, free, total })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SyncState;

    #[test]
    fn lists_files_dirs_hidden() {
        crate::com::init_sta();
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("a.txt"), b"hello").unwrap();
        std::fs::create_dir(d.path().join("sub")).unwrap();
        std::fs::write(d.path().join("s.lnk"), b"x").unwrap();
        let hidden = d.path().join("h.txt");
        std::fs::write(&hidden, b"h").unwrap();
        let status = std::process::Command::new("attrib")
            .arg("+h")
            .arg(&hidden)
            .status()
            .unwrap();
        assert!(status.success());
        let loc = d.path().to_string_lossy().to_string();

        let l = list(&loc, false).unwrap();
        assert!(l.folder.fs_path.is_some());
        assert_eq!(l.entries.len(), 3);
        assert!(l.entries.iter().all(|e| e.name != "h.txt"));
        let a = l.entries.iter().find(|e| e.name == "a.txt").unwrap();
        assert_eq!(a.size, Some(5));
        assert!(!a.is_folder && !a.is_link);
        assert!(a.location.ends_with("\\a.txt"));
        assert!(!a.type_name.is_empty());
        assert_eq!(a.sync_state, None);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        assert!((now - a.modified.unwrap()).abs() < 3_600_000);
        assert!((now - a.created.unwrap()).abs() < 3_600_000);
        assert!(a.accessed.is_some());
        assert_eq!(a.attributes.map(|x| x & 0x10), Some(0)); // not a directory
        let sub = l.entries.iter().find(|e| e.name == "sub").unwrap();
        assert!(sub.is_folder);
        assert_eq!(sub.size, None);
        assert!(!sub.type_name.is_empty());
        assert!(l.entries.iter().find(|e| e.name == "s.lnk").unwrap().is_link);

        let l = list(&loc, true).unwrap();
        assert_eq!(l.entries.len(), 4);
        assert!(l.entries.iter().find(|e| e.name == "h.txt").unwrap().hidden);
        let _ = SyncState::Available;
    }

    #[test]
    fn this_pc_has_drives() {
        crate::com::init_sta();
        let l = list("::{20D04FE0-3AEA-1069-A2D8-08002B30309D}", false).unwrap();
        assert!(l.folder.fs_path.is_none());
        let drives: Vec<_> = l.entries.iter().filter(|e| e.location.ends_with(":\\")).collect();
        assert!(!drives.is_empty(), "{:?}", l.entries);
        assert!(drives.iter().all(|e| e.is_folder && !e.name.is_empty()));
    }

    #[test]
    fn virtual_roots_list() {
        crate::com::init_sta();
        let l = list("DESKTOP", false).unwrap();
        assert!(l.folder.parent.is_none());
        assert!(!l.entries.is_empty());
        list("::{645FF040-5081-101B-9F08-00AA002F954E}", false).unwrap();
        list("::{F02C1A0D-BE21-4350-88B0-7367FC96EF3C}", false).unwrap();
    }

    #[test]
    fn disk_free_for_temp() {
        let d = tempfile::tempdir().unwrap();
        let df = disk_free(&d.path().to_string_lossy()).unwrap();
        assert_eq!(df.label.len(), 1);
        assert!(df.total > 0 && df.free <= df.total);
        assert!(disk_free("::{20D04FE0-3AEA-1069-A2D8-08002B30309D}").is_none());
        assert!(disk_free("DESKTOP").is_none());
        assert!(disk_free("\\\\server").is_none());
        assert_eq!(disk_label("\\\\srv\\share\\x").as_deref(), Some("srv"));
    }

    #[test]
    #[ignore]
    fn bench_list_10k() {
        crate::com::init_sta();
        let d = tempfile::tempdir().unwrap();
        for i in 0..10_000 {
            std::fs::write(d.path().join(format!("file{i}.txt")), b"x").unwrap();
        }
        let loc = d.path().to_string_lossy().to_string();
        let _ = list(&loc, false).unwrap(); // warm up caches
        let t = Instant::now();
        let l = list(&loc, false).unwrap();
        println!("bench_list_10k: {} entries in {:?} (elapsed_ms={})", l.entries.len(), t.elapsed(), l.elapsed_ms);
        assert_eq!(l.entries.len(), 10_000);
    }
}
