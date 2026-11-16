//! File-system fast path: FindFirstFileExW.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use windows::core::PCWSTR;
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, FILETIME};
use windows::Win32::Storage::FileSystem::{
    FindClose, FindExInfoBasic, FindExSearchNameMatch, FindFirstFileExW, FindNextFileW,
    FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_OFFLINE,
    FILE_ATTRIBUTE_PINNED, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS, FILE_ATTRIBUTE_RECALL_ON_OPEN,
    FILE_ATTRIBUTE_SYSTEM, FIND_FIRST_EX_LARGE_FETCH, WIN32_FIND_DATAW,
};
use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_TYPENAME, SHGFI_USEFILEATTRIBUTES};

use crate::com::{from_wide_buf, wide};
use crate::types::{Entry, SyncState};

const UNIX_EPOCH_100NS: u64 = 116_444_736_000_000_000;

pub fn filetime_to_unix_ms(ft: &FILETIME) -> Option<i64> {
    let t = ((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64;
    if t == 0 {
        return None;
    }
    Some((t as i64 - UNIX_EPOCH_100NS as i64) / 10_000)
}

fn type_cache() -> &'static Mutex<HashMap<String, String>> {
    static C: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

fn query_type_name(probe: &str, attrs: u32) -> String {
    let w = wide(probe);
    let mut info = SHFILEINFOW::default();
    let r = unsafe {
        SHGetFileInfoW(
            PCWSTR(w.as_ptr()),
            windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES(attrs),
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_TYPENAME | SHGFI_USEFILEATTRIBUTES,
        )
    };
    if r == 0 {
        return String::new();
    }
    from_wide_buf(&info.szTypeName)
}

/// Type name cached per lowercase extension (one entry for folders).
pub fn type_name(name: &str, is_folder: bool) -> String {
    let key = if is_folder {
        "\0folder".to_string()
    } else {
        match name.rfind('.') {
            Some(i) => name[i..].to_lowercase(),
            None => String::new(),
        }
    };
    if let Some(v) = type_cache().lock().unwrap().get(&key) {
        return v.clone();
    }
    let v = if is_folder {
        query_type_name("folder", FILE_ATTRIBUTE_DIRECTORY.0)
    } else {
        let probe = if key.is_empty() { "file".to_string() } else { format!("file{key}") };
        query_type_name(&probe, FILE_ATTRIBUTE_NORMAL.0)
    };
    type_cache().lock().unwrap().insert(key, v.clone());
    v
}

fn sync_state(attrs: u32) -> SyncState {
    if attrs & FILE_ATTRIBUTE_PINNED.0 != 0 {
        SyncState::Pinned
    } else if attrs
        & (FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS.0 | FILE_ATTRIBUTE_RECALL_ON_OPEN.0 | FILE_ATTRIBUTE_OFFLINE.0)
        != 0
    {
        SyncState::OnlineOnly
    } else {
        SyncState::Available
    }
}

pub fn list_dir(dir: &str, show_hidden: bool, sync_root: bool) -> Result<Vec<Entry>, String> {
    let base = dir.trim_end_matches('\\');
    let pattern = wide(&format!("{base}\\*"));
    let mut data = WIN32_FIND_DATAW::default();
    let found = unsafe {
        FindFirstFileExW(
            PCWSTR(pattern.as_ptr()),
            FindExInfoBasic,
            &mut data as *mut _ as *mut _,
            FindExSearchNameMatch,
            None,
            FIND_FIRST_EX_LARGE_FETCH,
        )
    };
    let handle = match found {
        Ok(h) => h,
        // The root of an empty drive has no entries at all (not even "." and ".."), which is
        // reported as "file not found": that is an empty folder, not a failure.
        Err(e) if e.code() == ERROR_FILE_NOT_FOUND.to_hresult() && std::path::Path::new(dir).is_dir() => {
            return Ok(Vec::new());
        }
        Err(e) => return Err(format!("フォルダを開けません: {dir} ({})", crate::com::err(e))),
    };

    let mut out = Vec::new();
    loop {
        let n = data.cFileName.iter().position(|&c| c == 0).unwrap_or(data.cFileName.len());
        let name_w = &data.cFileName[..n];
        let skip = name_w == [b'.' as u16] || name_w == [b'.' as u16, b'.' as u16];
        let attrs = data.dwFileAttributes;
        let hidden = attrs & FILE_ATTRIBUTE_HIDDEN.0 != 0;
        let system = attrs & FILE_ATTRIBUTE_SYSTEM.0 != 0;
        if !skip && (show_hidden || !(hidden || system)) {
            let name = String::from_utf16_lossy(name_w);
            let is_folder = attrs & FILE_ATTRIBUTE_DIRECTORY.0 != 0;
            let lower_ext_link = name.len() > 4 && {
                let tail = &name.as_bytes()[name.len() - 4..];
                tail.eq_ignore_ascii_case(b".lnk") || tail.eq_ignore_ascii_case(b".url")
            };
            out.push(Entry {
                location: format!("{base}\\{name}"),
                is_folder,
                is_link: lower_ext_link,
                size: if is_folder {
                    None
                } else {
                    Some(((data.nFileSizeHigh as u64) << 32) | data.nFileSizeLow as u64)
                },
                modified: filetime_to_unix_ms(&data.ftLastWriteTime),
                created: filetime_to_unix_ms(&data.ftCreationTime),
                accessed: filetime_to_unix_ms(&data.ftLastAccessTime),
                attributes: Some(attrs),
                type_name: type_name(&name, is_folder),
                hidden,
                system,
                sync_state: if sync_root { Some(sync_state(attrs)) } else { None },
                name,
            });
        }
        if unsafe { FindNextFileW(handle, &mut data) }.is_err() {
            break;
        }
    }
    let _ = unsafe { FindClose(handle) };
    Ok(out)
}
