//! Virtual folders (This PC, Recycle Bin, Network, `\\server`, Desktop): IEnumShellItems.

use windows::core::Interface;
use windows::Win32::Storage::EnhancedStorage::{
    PKEY_DateAccessed, PKEY_DateCreated, PKEY_DateModified, PKEY_FileAttributes, PKEY_ItemTypeText,
    PKEY_Size,
};
use windows::Win32::System::SystemServices::{
    SFGAO_FILESYSTEM, SFGAO_FOLDER, SFGAO_HIDDEN, SFGAO_LINK, SFGAO_STREAM,
};
use windows::Win32::UI::Shell::{BHID_EnumItems, IEnumShellItems, IShellItem, IShellItem2};

use super::fs::filetime_to_unix_ms;
use crate::com::{display_name, err, take_cotaskmem_string};
use crate::location;
use crate::types::Entry;

pub fn list_items(folder: &IShellItem, show_hidden: bool) -> Result<Vec<Entry>, String> {
    let en = bind_enum(folder)?;
    let mut out = Vec::new();
    loop {
        let mut buf: [Option<IShellItem>; 16] = Default::default();
        let mut fetched = 0u32;
        // The end of the list is S_FALSE, which is not an error. A failure before anything was
        // read is the folder's error. One part-way (a network place that stops answering) keeps
        // what was read: showing those items is better than an empty pane. It is noted in the log.
        if let Err(e) = unsafe { en.Next(&mut buf, Some(&mut fetched)) } {
            if out.is_empty() {
                return Err(err(e));
            }
            crate::logfile::line(&format!("listing stopped after {} items: {}", out.len(), err(e)));
            break;
        }
        if fetched == 0 {
            break;
        }
        for item in buf.iter().take(fetched as usize).flatten() {
            if let Some(e) = entry_of(item, show_hidden) {
                out.push(e);
            }
        }
    }
    Ok(out)
}

fn bind_enum(folder: &IShellItem) -> Result<IEnumShellItems, String> {
    unsafe { folder.BindToHandler::<_, IEnumShellItems>(None, &BHID_EnumItems) }.map_err(err)
}

fn entry_of(item: &IShellItem, show_hidden: bool) -> Option<Entry> {
    let mask = SFGAO_FOLDER | SFGAO_STREAM | SFGAO_HIDDEN | SFGAO_LINK | SFGAO_FILESYSTEM;
    let a = unsafe { item.GetAttributes(mask) }.map(|f| f.0).unwrap_or(0);
    let hidden = a & SFGAO_HIDDEN.0 != 0;
    if hidden && !show_hidden {
        return None;
    }
    let is_folder = location::folder_attrs(a);
    // An item that has no location cannot be opened or acted on: left out.
    let (location, _) = location::place_of(item, a & SFGAO_FILESYSTEM.0 != 0).ok()?;
    let name = display_name(item).unwrap_or_else(|_| location.clone());
    let (mut size, mut modified, mut type_name) = (None, None, String::new());
    let (mut created, mut accessed, mut attributes) = (None, None, None);
    if let Ok(i2) = item.cast::<IShellItem2>() {
        if !is_folder {
            size = unsafe { i2.GetUInt64(&PKEY_Size) }.ok();
        }
        let time = |key| unsafe { i2.GetFileTime(key) }.ok().and_then(|ft| filetime_to_unix_ms(&ft));
        modified = time(&PKEY_DateModified);
        created = time(&PKEY_DateCreated);
        accessed = time(&PKEY_DateAccessed);
        attributes = unsafe { i2.GetUInt32(&PKEY_FileAttributes) }.ok();
        if let Ok(p) = unsafe { i2.GetString(&PKEY_ItemTypeText) } {
            type_name = take_cotaskmem_string(p);
        }
    }
    Some(Entry {
        name,
        location,
        is_folder,
        is_link: a & SFGAO_LINK.0 != 0,
        size,
        modified,
        created,
        accessed,
        attributes,
        type_name,
        hidden,
        system: false,
        sync_state: None,
    })
}
