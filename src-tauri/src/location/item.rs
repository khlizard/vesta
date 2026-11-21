//! IShellItem helpers: the namespace root, attributes, and the location an item is known by.

use windows::Win32::System::SystemServices::{SFGAO_FILESYSTEM, SFGAO_FLAGS, SFGAO_FOLDER, SFGAO_STREAM};
use windows::Win32::UI::Shell::{IShellItem, SHCreateItemFromIDList, SHGetSpecialFolderLocation, SIGDN_FILESYSPATH};

use super::DESKTOP;
use crate::com::{Pidl, err, item_name, parsing_name, shell_item};

/// The virtual namespace root (Desktop).
pub(super) fn root_item() -> Result<IShellItem, String> {
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
    if crate::path::is_desktop(location) {
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

/// Whether attributes (asked for with FOLDER | STREAM at least) are those of a folder to go
/// into: FOLDER and not STREAM. An archive file such as a .zip is both, and is a file here.
pub fn folder_attrs(attrs: u32) -> bool {
    attrs & SFGAO_FOLDER.0 != 0 && attrs & SFGAO_STREAM.0 == 0
}

/// A folder to go into (see [`folder_attrs`]).
pub fn is_folder(item: &IShellItem) -> bool {
    folder_attrs(attrs(item, SFGAO_FOLDER | SFGAO_STREAM))
}

/// The parsing name of a Shell item as its location. An item without one cannot be found
/// again, so that is an error and not an empty location.
fn parsing_location(item: &IShellItem) -> Result<String, String> {
    match parsing_name(item) {
        Ok(name) if !name.is_empty() => Ok(name),
        Ok(_) => Err("この項目には場所の名前がありません".into()),
        Err(e) => Err(err(e)),
    }
}

/// Where a Shell item that is known not to be the root is: its canonical location and, for an
/// item of the file system (`filesystem`: it has SFGAO_FILESYSTEM), its path. The location is
/// the path when there is one, else the parsing name.
pub fn place_of(item: &IShellItem, filesystem: bool) -> Result<(String, Option<String>), String> {
    if filesystem && let Ok(p) = item_name(item, SIGDN_FILESYSPATH) {
        return Ok((p.clone(), Some(p)));
    }
    Ok((parsing_location(item)?, None))
}

/// Canonical location of a Shell item.
pub fn location_of(item: &IShellItem) -> Result<String, String> {
    if is_root(item) {
        return Ok(DESKTOP.into());
    }
    place_of(item, is_filesystem(item)).map(|(location, _)| location)
}
