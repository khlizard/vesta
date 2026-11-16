//! Resolving location strings (paths, UNC, `%ENV%`, `::{GUID}`, Avesta aliases).
//! Spec: docs/spec/navigation.md「場所の書き方」. Runs on an STA thread.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use windows::core::{GUID, PCWSTR};
use windows::Win32::Storage::CloudFilters::{
    CfGetSyncRootInfoByPath, CF_SYNC_ROOT_BASIC_INFO, CF_SYNC_ROOT_INFO_CLASS,
};
use windows::Win32::System::Environment::ExpandEnvironmentStringsW;
use windows::Win32::System::SystemServices::{SFGAO_FILESYSTEM, SFGAO_FLAGS, SFGAO_FOLDER, SFGAO_STREAM};
use windows::Win32::UI::Shell::{
    FOLDERID_Desktop, FOLDERID_Documents, FOLDERID_Music, FOLDERID_Pictures, FOLDERID_Profile,
    FOLDERID_ProgramFiles, FOLDERID_System, FOLDERID_Videos, FOLDERID_Windows, IShellItem,
    BHID_LinkTargetItem,
    SHCreateItemFromIDList, SHGetKnownFolderPath, SHGetSpecialFolderLocation, KF_FLAG_DEFAULT,
    SIGDN_FILESYSPATH,
};

use crate::com::{
    display_name, err, from_wide_buf, item_name, parsing_name, shell_item, take_cotaskmem_string,
    wide, Pidl,
};
use crate::types::{FolderInfo, Resolved};

/// Location string of the virtual Shell namespace root.
pub const DESKTOP: &str = "DESKTOP";

const THIS_PC: &str = "::{20D04FE0-3AEA-1069-A2D8-08002B30309D}";
const RECYCLE_BIN: &str = "::{645FF040-5081-101B-9F08-00AA002F954E}";
const NETWORK: &str = "::{F02C1A0D-BE21-4350-88B0-7367FC96EF3C}";
const CONTROL_PANEL: &str = "::{26EE0668-A00A-44D7-9371-BEB064C98683}";

static AVESTA_DIR: OnceLock<std::path::PathBuf> = OnceLock::new();

/// Sets the folder the `AVESTA` alias points to (the app config dir, parent of `usr/`).
pub fn set_avesta_dir(path: std::path::PathBuf) {
    let _ = AVESTA_DIR.set(path);
}

enum AliasTarget {
    Known(GUID),
    Fixed(&'static str),
    Root,
    Avesta,
}

fn alias_target(name: &str) -> Option<AliasTarget> {
    use AliasTarget::*;
    Some(match name {
        "DESKTOP" => Root,
        "DESKTOPDIRECTORY" => Known(FOLDERID_Desktop),
        "DRIVES" | "DRIVE" => Fixed(THIS_PC),
        "HOME" | "MYDOCUMENTS" | "PERSONAL" => Known(FOLDERID_Documents),
        "MYMUSIC" => Known(FOLDERID_Music),
        "MYPICTURES" | "MYPICTURE" => Known(FOLDERID_Pictures),
        "MYVIDEO" | "MYVIDEOS" => Known(FOLDERID_Videos),
        "PROFILE" => Known(FOLDERID_Profile),
        "CONTROLS" | "CONTROLPANEL" | "CONTROL" => Fixed(CONTROL_PANEL),
        "BITBUCKET" | "RECYCLEBIN" | "TRASH" => Fixed(RECYCLE_BIN),
        "NETWORK" | "NETHOOD" => Fixed(NETWORK),
        "PROGRAM_FILES" => Known(FOLDERID_ProgramFiles),
        "SYSTEM" => Known(FOLDERID_System),
        "WINDOWS" => Known(FOLDERID_Windows),
        "AVESTA" | "VESTA" => Avesta,
        _ => return None,
    })
}

fn known_folder_path(id: &GUID) -> Result<String, String> {
    let p = unsafe { SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None) }.map_err(err)?;
    Ok(take_cotaskmem_string(p))
}

pub(crate) fn expand_env(s: &str) -> String {
    if !s.contains('%') {
        return s.to_string();
    }
    let w = wide(s);
    let n = unsafe { ExpandEnvironmentStringsW(PCWSTR(w.as_ptr()), None) };
    if n == 0 {
        return s.to_string();
    }
    let mut buf = vec![0u16; n as usize];
    let n2 = unsafe { ExpandEnvironmentStringsW(PCWSTR(w.as_ptr()), Some(&mut buf)) };
    if n2 == 0 {
        return s.to_string();
    }
    from_wide_buf(&buf)
}

/// Text normalisation and alias expansion. Returns the string to hand to the Shell,
/// or `DESKTOP` for the namespace root.
fn normalize(input: &str) -> Result<String, String> {
    let mut s = input.trim().trim_matches('"').trim().replace('/', "\\");
    if s.is_empty() {
        return Err("場所が空です".into());
    }
    s = expand_env(&s);
    let b = s.as_bytes();
    if b.len() == 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        s.push('\\');
    }
    let (head, rest) = match s.split_once('\\') {
        Some((h, r)) => (h, r),
        None => (s.as_str(), ""),
    };
    if let Some(target) = alias_target(&head.to_ascii_uppercase()) {
        let rest = rest.trim_matches('\\');
        let base = match target {
            AliasTarget::Root => {
                if rest.is_empty() {
                    return Ok(DESKTOP.into());
                }
                known_folder_path(&FOLDERID_Desktop)?
            }
            AliasTarget::Known(id) => known_folder_path(&id)?,
            AliasTarget::Fixed(p) => p.to_string(),
            AliasTarget::Avesta => AVESTA_DIR
                .get()
                .ok_or("AVESTA alias is not available yet")?
                .to_string_lossy()
                .into_owned(),
        };
        return Ok(if rest.is_empty() {
            base
        } else {
            format!("{}\\{}", base.trim_end_matches('\\'), rest)
        });
    }
    Ok(s)
}

/// The virtual namespace root (Desktop).
fn root_item() -> Result<IShellItem, String> {
    let pidl = unsafe { SHGetSpecialFolderLocation(None, 0) }.map_err(err)?;
    let pidl = Pidl(pidl);
    unsafe { SHCreateItemFromIDList::<IShellItem>(pidl.as_ptr()) }.map_err(err)
}

thread_local! {
    static ROOT: std::cell::RefCell<Option<IShellItem>> = const { std::cell::RefCell::new(None) };
}

pub fn is_root(item: &IShellItem) -> bool {
    ROOT.with(|r| {
        let mut r = r.borrow_mut();
        if r.is_none() {
            *r = root_item().ok();
        }
        match r.as_ref() {
            Some(root) => unsafe { root.Compare(item, 0) }.map(|v| v == 0).unwrap_or(false),
            None => false,
        }
    })
}

/// Shell item for a canonical location (`DESKTOP` or anything the Shell can parse).
pub fn item_for(location: &str) -> Result<IShellItem, String> {
    if location.eq_ignore_ascii_case(DESKTOP) {
        return root_item();
    }
    shell_item(location).map_err(|e| format!("場所が見つかりません: {location} ({})", err(e)))
}

pub fn attrs(item: &IShellItem, mask: SFGAO_FLAGS) -> u32 {
    unsafe { item.GetAttributes(mask) }.map(|f| f.0).unwrap_or(0)
}

pub fn is_filesystem(item: &IShellItem) -> bool {
    attrs(item, SFGAO_FILESYSTEM) & SFGAO_FILESYSTEM.0 != 0
}

/// Canonical location of a Shell item that is known not to be the root.
pub fn location_of_nonroot(item: &IShellItem) -> String {
    if is_filesystem(item) && let Ok(p) = item_name(item, SIGDN_FILESYSPATH) {
        return p;
    }
    parsing_name(item).unwrap_or_default()
}

/// Canonical location of a Shell item.
pub fn location_of(item: &IShellItem) -> String {
    if is_root(item) {
        return DESKTOP.into();
    }
    location_of_nonroot(item)
}

/// Resolves user input (address bar, link.xml `path`, execute paths) to a folder or a file.
pub fn resolve(input: &str) -> Result<Resolved, String> {
    let s = normalize(input)?;
    let item = item_for(&s).map_err(|_| format!("場所が見つかりません: {}", input.trim()))?;
    let a = attrs(&item, SFGAO_FOLDER | SFGAO_STREAM);
    if a & SFGAO_FOLDER.0 != 0 && a & SFGAO_STREAM.0 == 0 {
        Ok(Resolved::Folder { folder: info_from_item(&item)? })
    } else {
        Ok(Resolved::File { location: location_of(&item) })
    }
}

/// The folder a shortcut (.lnk) points to; `None` when `location` is not a shortcut, or its
/// target is a file or cannot be found. Spec: docs/spec/navigation.md「ファイルを開く」
pub fn link_folder(location: &str) -> Option<FolderInfo> {
    let item = item_for(location).ok()?;
    let target: IShellItem =
        unsafe { item.BindToHandler(None::<&windows::Win32::System::Com::IBindCtx>, &BHID_LinkTargetItem) }.ok()?;
    let a = attrs(&target, SFGAO_FOLDER | SFGAO_STREAM);
    if a & SFGAO_FOLDER.0 != 0 && a & SFGAO_STREAM.0 == 0 { info_from_item(&target).ok() } else { None }
}

/// Folder information for a canonical location (public API of this module; used by tests,
/// `listing::list` uses `info_from_item` to avoid creating the item twice).
#[allow(dead_code)]
pub fn folder_info(location: &str) -> Result<FolderInfo, String> {
    info_from_item(&item_for(location)?)
}

pub fn info_from_item(item: &IShellItem) -> Result<FolderInfo, String> {
    let root = is_root(item);
    let fs = !root && is_filesystem(item);
    let fs_path = if fs { item_name(item, SIGDN_FILESYSPATH).ok() } else { None };
    let location = if root {
        DESKTOP.to_string()
    } else {
        fs_path.clone().unwrap_or_else(|| parsing_name(item).unwrap_or_default())
    };
    let parent = if root {
        None
    } else {
        Some(
            unsafe { item.GetParent() }
                .map(|p| location_of(&p))
                .unwrap_or_else(|_| DESKTOP.to_string()),
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

fn sync_cache() -> &'static Mutex<HashMap<String, bool>> {
    static C: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// True when `path` is inside a cloud-files sync root. Results are cached per path;
/// a cached sync-root ancestor answers for its descendants.
pub fn is_sync_root(path: &str) -> bool {
    let key = path.trim_end_matches('\\').to_lowercase();
    {
        let cache = sync_cache().lock().unwrap();
        if let Some(&v) = cache.get(&key) {
            return v;
        }
        let mut p = key.as_str();
        while let Some(i) = p.rfind('\\') {
            p = &p[..i];
            if cache.get(p) == Some(&true) {
                return true;
            }
        }
    }
    let w = wide(path);
    let mut buf = [0u8; std::mem::size_of::<CF_SYNC_ROOT_BASIC_INFO>() + 8];
    let ok = unsafe {
        CfGetSyncRootInfoByPath(
            PCWSTR(w.as_ptr()),
            CF_SYNC_ROOT_INFO_CLASS(0), // CF_SYNC_ROOT_INFO_BASIC
            buf.as_mut_ptr() as *mut _,
            buf.len() as u32,
            None,
        )
    }
    .is_ok();
    sync_cache().lock().unwrap().insert(key, ok);
    ok
}

/// The topmost folder of `path` (itself included) for which `inside` holds, walking up while
/// the parent still does. `None` when `path` itself does not.
fn topmost_while(path: &str, inside: impl Fn(&str) -> bool) -> Option<String> {
    let mut p = path.trim_end_matches('\\');
    if !inside(p) {
        return None;
    }
    while let Some(i) = p.rfind('\\') {
        let parent = &p[..i];
        // `C:` and the `\\server` part of a network path are not folders to ask about.
        let server_only = parent.starts_with(r"\\") && !parent[2..].contains('\\');
        if parent.len() < 3 || server_only || !inside(parent) {
            break;
        }
        p = parent;
    }
    Some(p.to_string())
}

/// Path of the cloud sync root that `path` is in, or `None` outside one.
pub fn sync_root_of(path: &str) -> Option<String> {
    topmost_while(path, is_sync_root)
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

    #[test]
    fn topmost_while_walks_up_to_the_root_of_the_region() {
        let inside = |p: &str| p.to_lowercase().starts_with(r"d:\users\a\dropbox");
        assert_eq!(topmost_while(r"D:\Users\a\Dropbox\Work\x\", inside).as_deref(), Some(r"D:\Users\a\Dropbox"));
        assert_eq!(topmost_while(r"D:\Users\a\Dropbox", inside).as_deref(), Some(r"D:\Users\a\Dropbox"));
        assert_eq!(topmost_while(r"D:\Users\a", inside), None);
        // A whole drive or share: stops at its first folder level without asking about `D:` or `\\server`.
        assert_eq!(topmost_while(r"D:\a\b", |_| true).as_deref(), Some(r"D:\a"));
        assert_eq!(topmost_while(r"\\srv\share\a", |_| true).as_deref(), Some(r"\\srv\share"));
    }

    /// Prints the sync root of a real folder: set VESTA_TEST_SYNC_PATH and run with --ignored.
    #[test]
    #[ignore]
    fn sync_root_of_real_folder() {
        let Ok(path) = std::env::var("VESTA_TEST_SYNC_PATH") else { return };
        println!("sync_root_of({path}) = {:?}", sync_root_of(&path));
    }

    fn folder(r: Result<Resolved, String>) -> FolderInfo {
        match r.unwrap() {
            Resolved::Folder { folder } => folder,
            other => panic!("expected folder, got {other:?}"),
        }
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
        assert_eq!(folder_info(DESKTOP).unwrap(), d);
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
