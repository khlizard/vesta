//! Taking items back out of the Recycle Bin (undoing a delete).

use windows::Win32::System::Com::IBindCtx;
use windows::Win32::UI::Shell::{
    BHID_EnumItems, IEnumShellItems, IShellItem, SHGetIDListFromObject, SIGDN_FILESYSPATH,
};

use super::history::{NAME_TAKEN, exists};
use crate::com::{Hwnd, Pidl, item_name, shell_item};
use crate::context_menu::BuiltMenu;
use crate::location::RECYCLE_BIN;

/// Restores each `(original path, path in the Recycle Bin)` of `items`. One result for each
/// item, in order.
pub(super) fn restore(items: &[(String, String)], owner: Hwnd, silent: bool) -> Vec<Result<(), String>> {
    // One pass over the Recycle Bin for all the items (it can hold thousands).
    let wanted: Vec<&str> =
        items.iter().filter(|(original, _)| !exists(original)).map(|(_, bin)| bin.as_str()).collect();
    let found = find_in_recycle_bin(&wanted);
    items
        .iter()
        .map(|(original, bin_path)| {
            let pidl = found.iter().find(|(p, _)| p.eq_ignore_ascii_case(bin_path)).map(|(_, pidl)| pidl);
            restore_one(original, bin_path, pidl, owner, silent)
        })
        .collect()
}

/// Restores a Recycle Bin item to `original` with the "undelete" verb of the item in the Recycle
/// Bin folder (`pidl`); falls back to moving the `$R...` file back. Never replaces what is at
/// `original` now (the verb would ask to, with the Windows dialog).
fn restore_one(
    original: &str,
    bin_path: &str,
    pidl: Option<&Pidl>,
    owner: Hwnd,
    silent: bool,
) -> Result<(), String> {
    if exists(original) {
        return Err(NAME_TAKEN.into());
    }
    let verb = match pidl {
        Some(pidl) => BuiltMenu::of_item(owner.get(), pidl)
            .and_then(|menu| menu.invoke_verb(owner.get(), "undelete", silent)),
        None => Err("ごみ箱の中に項目が見つかりません".to_string()),
    };
    if verb.is_ok() && exists(original) {
        return Ok(());
    }
    let verb_err = verb.err().unwrap_or_else(|| "元の場所に戻りませんでした".into());
    move_back(bin_path, original).map_err(|e| format!("{verb_err}; {e}"))
}

/// Moves the Recycle Bin file back by hand. Never replaces what is at `original` now:
/// something else may have been created there since the delete (`fs::rename` would overwrite it).
fn move_back(bin_path: &str, original: &str) -> Result<(), String> {
    if exists(original) {
        return Err(NAME_TAKEN.into());
    }
    std::fs::rename(bin_path, original).map_err(|e| e.to_string())
}

/// Looks up the Recycle Bin folder items whose file system paths are `bin_paths` and returns
/// each path found with the item's absolute PIDL (a plain file PIDL has no "undelete" verb).
fn find_in_recycle_bin(bin_paths: &[&str]) -> Vec<(String, Pidl)> {
    let mut found: Vec<(String, Pidl)> = Vec::new();
    if bin_paths.is_empty() {
        return found;
    }
    let Some(items) = shell_item(RECYCLE_BIN)
        .ok()
        .and_then(|bin| unsafe { bin.BindToHandler::<_, IEnumShellItems>(None::<&IBindCtx>, &BHID_EnumItems) }.ok())
    else {
        return found;
    };
    let all_found = |found: &[(String, Pidl)]| {
        bin_paths.iter().all(|want| found.iter().any(|(p, _)| p.eq_ignore_ascii_case(want)))
    };
    loop {
        let mut buf: [Option<IShellItem>; 16] = Default::default();
        let mut fetched = 0u32;
        if unsafe { items.Next(&mut buf, Some(&mut fetched)) }.is_err() || fetched == 0 {
            return found;
        }
        for item in buf.iter().take(fetched as usize).flatten() {
            let Ok(path) = item_name(item, SIGDN_FILESYSPATH) else { continue };
            if bin_paths.iter().any(|want| want.eq_ignore_ascii_case(&path))
                && let Ok(pidl) = unsafe { SHGetIDListFromObject(item) }
            {
                found.push((path, Pidl(pidl)));
                if all_found(&found) {
                    return found;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::move_back;

    #[test]
    fn does_not_overwrite_an_existing_item() {
        let dir = std::env::temp_dir().join(format!("vesta-moveback-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (bin, orig) = (dir.join("bin.txt"), dir.join("orig.txt"));
        std::fs::write(&bin, "deleted").unwrap();
        std::fs::write(&orig, "new").unwrap();
        let (b, o) = (bin.to_string_lossy().into_owned(), orig.to_string_lossy().into_owned());
        assert!(move_back(&b, &o).is_err());
        assert_eq!(std::fs::read_to_string(&orig).unwrap(), "new");
        assert!(bin.exists());
        std::fs::remove_file(&orig).unwrap();
        assert!(move_back(&b, &o).is_ok());
        assert_eq!(std::fs::read_to_string(&orig).unwrap(), "deleted");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
