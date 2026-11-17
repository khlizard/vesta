//! Resolving location strings (paths, UNC, `%ENV%`, `::{GUID}`, Avesta aliases).
//! Spec: docs/spec/navigation.md「場所の書き方」. Runs on an STA thread.
//!
//! - `alias`: Avesta's names for places, and the text clean-up of what was typed.
//! - `item`: IShellItem helpers (the root, attributes, the location of an item).
//! - `link`: following shortcuts (.lnk).
//! - `sync_root`: cloud-files sync roots.

mod alias;
mod item;
mod link;
mod sync_root;

use windows::Win32::UI::Shell::IShellItem;

use crate::com::{self, display_name, err};
use crate::types::{FolderInfo, Resolved};

pub use alias::set_avesta_dir;
pub(crate) use alias::expand_env;
pub use item::{folder_attrs, item_for, place_of};
pub use link::link_folder;
use item::{is_filesystem, is_folder, is_root, location_of, root_item};
use sync_root::sync_root_of;

/// Location string of the virtual Shell namespace root.
pub const DESKTOP: &str = "DESKTOP";

const THIS_PC: &str = "::{20D04FE0-3AEA-1069-A2D8-08002B30309D}";
pub(crate) const RECYCLE_BIN: &str = "::{645FF040-5081-101B-9F08-00AA002F954E}";
const NETWORK: &str = "::{F02C1A0D-BE21-4350-88B0-7367FC96EF3C}";
const CONTROL_PANEL: &str = "::{26EE0668-A00A-44D7-9371-BEB064C98683}";

/// `resolve` on the listing threads.
pub async fn resolve_async(input: String) -> Result<Resolved, String> {
    com::list_pool().run(move || resolve(&input)).await?
}

/// `link_folder` on the listing threads.
pub async fn link_folder_async(location: String) -> Result<Option<FolderInfo>, String> {
    com::list_pool().run(move || link_folder(&location)).await
}

/// `ancestors` on the listing threads.
pub async fn ancestors_async(location: String) -> Result<Vec<FolderInfo>, String> {
    com::list_pool().run(move || ancestors(&location)).await?
}

/// Resolves user input (address bar, link.xml `path`, execute paths) to a folder or a file.
pub fn resolve(input: &str) -> Result<Resolved, String> {
    let s = alias::normalize(input)?;
    let item = item_for(&s).map_err(|_| format!("場所が見つかりません: {}", input.trim()))?;
    if is_folder(&item) {
        Ok(Resolved::Folder { folder: info_from_item(&item)? })
    } else {
        Ok(Resolved::File { location: location_of(&item)? })
    }
}

pub fn info_from_item(item: &IShellItem) -> Result<FolderInfo, String> {
    let root = is_root(item);
    let (location, fs_path) = if root {
        (DESKTOP.to_string(), None)
    } else {
        place_of(item, is_filesystem(item))?
    };
    let parent = if root {
        None
    } else {
        // A parent that cannot be had or named: going up leads to the root.
        Some(
            unsafe { item.GetParent() }
                .ok()
                .and_then(|p| location_of(&p).ok())
                .unwrap_or_else(|| DESKTOP.to_string()),
        )
    };
    let name = display_name(item).map_err(err)?;
    let sync_root_path = fs_path.as_deref().and_then(sync_root_of);
    let sync_root = sync_root_path.is_some();
    Ok(FolderInfo { location, display_name: name, fs_path, parent, sync_root, sync_root_path })
}

/// Ancestors from the Desktop down to `location` itself (inclusive), for the address bar dropdown.
pub fn ancestors(location: &str) -> Result<Vec<FolderInfo>, String> {
    let mut item = item_for(location)?;
    let mut out = Vec::new();
    loop {
        let info = info_from_item(&item)?;
        let at_root = info.location == DESKTOP;
        out.push(info);
        if at_root {
            break;
        }
        match unsafe { item.GetParent() } {
            Ok(p) => item = p,
            Err(_) => {
                out.push(info_from_item(&root_item()?)?);
                break;
            }
        }
    }
    out.reverse();
    Ok(out)
}

/// For tests: the path with 8.3 short names (RUNNER~1) expanded, without the `\\?\` prefix.
#[cfg(test)]
pub(crate) fn long_path(path: &std::path::Path) -> std::path::PathBuf {
    let full = std::fs::canonicalize(path).unwrap();
    let text = full.to_string_lossy();
    std::path::PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(r: Result<Resolved, String>) -> FolderInfo {
        match r.unwrap() {
            Resolved::Folder { folder } => folder,
            other => panic!("expected folder, got {other:?}"),
        }
    }

    #[test]
    fn aliases_case_insensitive_and_subpath() {
        crate::com::init_sta();
        let f = folder(resolve("windows"));
        assert!(f.location.eq_ignore_ascii_case(&std::env::var("SystemRoot").unwrap()));
        let f = folder(resolve("WINDOWS\\System32"));
        assert!(f.location.to_lowercase().ends_with("\\windows\\system32"));
        let f = folder(resolve("Profile"));
        assert!(f.fs_path.is_some());
        // `~` is the profile folder; only as the whole first component.
        let home = f.location;
        assert_eq!(folder(resolve("~")).location, home);
        let sub = folder(resolve("~/AppData")).location;
        assert!(sub.eq_ignore_ascii_case(&format!("{home}\\AppData")));
        assert_eq!(folder(resolve("~\\AppData\\")).location, sub);
        assert!(resolve("~nobody-here").is_err());
        assert_eq!(folder(resolve("DESKTOP")).location, DESKTOP);
        assert!(folder(resolve("desktopdirectory")).fs_path.is_some());
        assert!(resolve("AVESTA").unwrap_err().contains("not available"));
        assert!(resolve("VESTA").unwrap_err().contains("not available"));
    }

    #[test]
    fn env_quotes_slash_drive() {
        crate::com::init_sta();
        let f = folder(resolve("\"%TEMP%\""));
        let tmp = std::env::temp_dir();
        assert_eq!(
            std::fs::canonicalize(&f.location).unwrap(),
            std::fs::canonicalize(&tmp).unwrap()
        );
        assert_eq!(folder(resolve("  C:  ")).location, "C:\\");
        assert!(folder(resolve("C:/Windows")).location.eq_ignore_ascii_case("C:\\Windows"));
    }

    #[test]
    fn temp_dir_file_missing() {
        crate::com::init_sta();
        let d = tempfile::tempdir().unwrap();
        let f = folder(resolve(&d.path().to_string_lossy()));
        assert!(f.fs_path.is_some());
        assert!(f.parent.is_some());
        let file = d.path().join("a.txt");
        std::fs::write(&file, b"x").unwrap();
        match resolve(&file.to_string_lossy()).unwrap() {
            Resolved::File { location } => assert!(location.to_lowercase().ends_with("a.txt")),
            other => panic!("{other:?}"),
        }
        assert!(resolve(&d.path().join("nope").to_string_lossy()).is_err());
    }

    #[test]
    fn virtual_folders() {
        crate::com::init_sta();
        for a in ["DRIVES", "BITBUCKET", "NETWORK", "CONTROLS"] {
            let f = folder(resolve(a));
            assert!(f.fs_path.is_none(), "{a}");
            assert!(f.location.starts_with("::"), "{a}: {}", f.location);
            assert!(!f.display_name.is_empty());
        }
        let d = folder(resolve("DESKTOP"));
        assert!(d.parent.is_none());
        let pc = folder(resolve("::{20D04FE0-3AEA-1069-A2D8-08002B30309D}"));
        assert_eq!(pc.parent.as_deref(), Some(DESKTOP));
        assert_eq!(info_from_item(&item_for(DESKTOP).unwrap()).unwrap(), d);
        let c = folder(resolve("C:\\"));
        assert_eq!(c.parent.as_deref(), Some(pc.location.as_str()));
    }

    #[test]
    fn ancestors_of_temp_dir() {
        crate::com::init_sta();
        let d = tempfile::tempdir().unwrap();
        let loc = folder(resolve(&d.path().to_string_lossy())).location;
        let list = ancestors(&loc).unwrap();
        assert_eq!(list.first().unwrap().location, DESKTOP);
        assert_eq!(list.last().unwrap().location, loc);
        assert!(list.len() >= 3);
    }
}
