//! Explorer context menus (IContextMenu / IContextMenu2 / IContextMenu3).

use std::cell::RefCell;

use windows::core::{Interface, PCSTR, PCWSTR, PSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VIRTUAL_KEY, VK_CONTROL, VK_SHIFT};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    BHID_SFObject, DefSubclassProc, IContextMenu, IContextMenu2, IContextMenu3, ILFindLastID,
    IShellFolder, SHGetDesktopFolder, SetWindowSubclass, CMF_CANRENAME, CMF_EXTENDEDVERBS,
    CMF_NORMAL, CMIC_MASK_CONTROL_DOWN, CMIC_MASK_PTINVOKE, CMIC_MASK_SHIFT_DOWN,
    CMINVOKECOMMANDINFOEX, GCS_VERBW, SEE_MASK_UNICODE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreatePopupMenu, DestroyMenu, TrackPopupMenuEx, HMENU, SW_SHOWNORMAL, TPM_RETURNCMD,
    TPM_RIGHTBUTTON, WM_DRAWITEM, WM_INITMENUPOPUP, WM_MEASUREITEM, WM_MENUCHAR,
};

use crate::com::{self, Pidl};
use crate::path;

/// Verbs the app handles itself; the menu returns them instead of invoking them.
pub const APP_VERBS: &[&str] = &["rename", "delete", "cut", "copy", "paste", "properties"];

const ID_FIRST: u32 = 1;
const ID_LAST: u32 = 0x7FFF;
const SUBCLASS_ID: usize = 0x4156_4D45; // "AVME"

#[derive(Clone)]
struct ActiveMenu {
    cm2: Option<IContextMenu2>,
    cm3: Option<IContextMenu3>,
}

thread_local! {
    static ACTIVE: RefCell<Option<ActiveMenu>> = const { RefCell::new(None) };
}

/// Installs the window subclass that forwards menu messages to IContextMenu2/3.
pub fn install(window: &tauri::WebviewWindow) -> Result<(), String> {
    let hwnd = com::hwnd_of(window)?;
    let ok = unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0) };
    if ok.as_bool() {
        Ok(())
    } else {
        Err("SetWindowSubclass failed".into())
    }
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if matches!(msg, WM_INITMENUPOPUP | WM_DRAWITEM | WM_MEASUREITEM | WM_MENUCHAR) {
        // Clone out of the thread-local so nested messages cannot hit a held borrow.
        let active = ACTIVE.with(|a| a.borrow().clone());
        if let Some(active) = active {
            if let Some(cm3) = &active.cm3 {
                let mut result = LRESULT(0);
                if unsafe { cm3.HandleMenuMsg2(msg, wparam, lparam, Some(&mut result)) }.is_ok() {
                    return result;
                }
            } else if let Some(cm2) = &active.cm2
                && msg != WM_MENUCHAR
                && unsafe { cm2.HandleMenuMsg(msg, wparam, lparam) }.is_ok()
            {
                return if msg == WM_INITMENUPOPUP { LRESULT(0) } else { LRESULT(1) };
            }
        }
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

pub(crate) fn shell_folder(folder: &str) -> Result<IShellFolder, String> {
    unsafe {
        if path::is_desktop(folder) {
            SHGetDesktopFolder().map_err(com::err)
        } else {
            let item = com::shell_item(folder).map_err(com::err)?;
            item.BindToHandler::<_, IShellFolder>(None, &BHID_SFObject)
                .map_err(com::err)
        }
    }
}

/// An IContextMenu with its populated popup menu.
struct BuiltMenu {
    cm: IContextMenu,
    hmenu: HMENU,
}

impl Drop for BuiltMenu {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyMenu(self.hmenu);
        }
    }
}

fn build_menu(hwnd: HWND, folder: &str, items: &[String], extended: bool) -> Result<BuiltMenu, String> {
    let sf = shell_folder(folder)?;
    let cm: IContextMenu = if items.is_empty() {
        unsafe { sf.CreateViewObject::<IContextMenu>(hwnd) }.map_err(com::err)?
    } else {
        let pidls = items
            .iter()
            .map(|i| Pidl::from_parsing(i).map_err(com::err))
            .collect::<Result<Vec<_>, _>>()?;
        // Children are relative PIDLs pointing into the absolute ones (kept alive by `pidls`).
        let children: Vec<*const ITEMIDLIST> = pidls
            .iter()
            .map(|p| unsafe { ILFindLastID(p.as_ptr()) } as *const ITEMIDLIST)
            .collect();
        unsafe { sf.GetUIObjectOf::<IContextMenu>(hwnd, &children, None) }.map_err(com::err)?
    };

    let hmenu = unsafe { CreatePopupMenu() }.map_err(com::err)?;
    let mut flags = CMF_NORMAL | CMF_CANRENAME;
    if extended {
        flags |= CMF_EXTENDEDVERBS;
    }
    if let Err(e) = unsafe { cm.QueryContextMenu(hmenu, 0, ID_FIRST, ID_LAST, flags) }.ok() {
        unsafe {
            let _ = DestroyMenu(hmenu);
        }
        return Err(com::err(e));
    }
    Ok(BuiltMenu { cm, hmenu })
}

/// The verb of menu command `id` ("" when it has none). Asked only for the command the user
/// chose: probing every possible id made each right-click slow, and some shell extensions
/// misbehave when asked about ids that are not theirs.
fn verb_of(cm: &IContextMenu, id: u32) -> String {
    let mut buf = [0u16; 256];
    let r = unsafe {
        cm.GetCommandString(
            (id - ID_FIRST) as usize,
            GCS_VERBW,
            None,
            PSTR(buf.as_mut_ptr() as *mut u8),
            buf.len() as u32,
        )
    };
    if r.is_ok() { com::from_wide_buf(&buf).to_lowercase() } else { String::new() }
}

fn key_down(vk: VIRTUAL_KEY) -> bool {
    unsafe { GetKeyState(vk.0 as i32) < 0 }
}

fn show_blocking(
    hwnd: HWND,
    folder: &str,
    items: &[String],
    x: f64,
    y: f64,
    scale: f64,
) -> Result<Option<String>, String> {
    let shift = key_down(VK_SHIFT);
    let built = build_menu(hwnd, folder, items, shift)?;

    let mut pt = POINT { x: (x * scale).round() as i32, y: (y * scale).round() as i32 };
    unsafe {
        let _ = ClientToScreen(hwnd, &mut pt);
    }

    ACTIVE.with(|a| {
        *a.borrow_mut() = Some(ActiveMenu {
            cm2: built.cm.cast::<IContextMenu2>().ok(),
            cm3: built.cm.cast::<IContextMenu3>().ok(),
        });
    });
    let cmd = unsafe {
        TrackPopupMenuEx(built.hmenu, (TPM_RETURNCMD | TPM_RIGHTBUTTON).0, pt.x, pt.y, hwnd, None)
    };
    ACTIVE.with(|a| *a.borrow_mut() = None);

    let id = cmd.0 as u32;
    if id == 0 {
        return Ok(None);
    }
    let verb = verb_of(&built.cm, id);
    if APP_VERBS.contains(&verb.as_str()) {
        return Ok(Some(verb));
    }

    // Directory for the invoked command (file system folders only).
    let dir: Option<Vec<u16>> = if path::is_desktop(folder) {
        None
    } else {
        com::shell_item(folder)
            .ok()
            .and_then(|i| com::parsing_name(&i).ok())
            .filter(|p| !path::is_virtual(p) && !p.starts_with("\\\\?\\"))
            .map(|p| com::wide(&p))
    };

    // CMIC_MASK_UNICODE has the same value as SEE_MASK_UNICODE (0x4000).
    let mut mask = SEE_MASK_UNICODE | CMIC_MASK_PTINVOKE;
    if key_down(VK_CONTROL) {
        mask |= CMIC_MASK_CONTROL_DOWN;
    }
    if shift {
        mask |= CMIC_MASK_SHIFT_DOWN;
    }
    let offset = (id - ID_FIRST) as usize;
    let info = CMINVOKECOMMANDINFOEX {
        cbSize: std::mem::size_of::<CMINVOKECOMMANDINFOEX>() as u32,
        fMask: mask,
        hwnd,
        lpVerb: PCSTR(offset as *const u8),
        lpVerbW: PCWSTR(offset as *const u16),
        lpDirectoryW: dir.as_ref().map_or(PCWSTR::null(), |d| PCWSTR(d.as_ptr())),
        nShow: SW_SHOWNORMAL.0,
        ptInvoke: pt,
        ..Default::default()
    };
    unsafe {
        built
            .cm
            .InvokeCommand(&info as *const CMINVOKECOMMANDINFOEX as *const _)
            .map_err(com::err)?;
    }
    Ok(None)
}

/// Shows the context menu for `items` in `folder` (empty `items` = folder background menu)
/// at client coordinates (`x`, `y`) in CSS pixels. Returns an app verb from [`APP_VERBS`]
/// if the user chose one, otherwise `None` (the Shell already ran the command, or nothing was chosen).
pub async fn show(
    window: tauri::WebviewWindow,
    folder: String,
    items: Vec<String>,
    x: f64,
    y: f64,
) -> Result<Option<String>, String> {
    let raw = com::hwnd_of(&window)?.0 as isize;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let hwnd = HWND(raw as *mut core::ffi::c_void);
            let _ = tx.send(show_blocking(hwnd, &folder, &items, x, y, scale));
        })
        .map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "context menu was dropped".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::GetMenuItemCount;

    #[test]
    fn file_menu_has_standard_verbs() {
        com::init_sta();
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.txt");
        std::fs::write(&f, b"x").unwrap();
        let built = build_menu(
            HWND::default(),
            &dir.path().to_string_lossy(),
            &[f.to_string_lossy().to_string()],
            false,
        )
        .unwrap();
        // The verbs of the menu's own commands (the test may probe a range; the app asks one id).
        let verbs: Vec<String> =
            (ID_FIRST..ID_FIRST + 512).map(|id| verb_of(&built.cm, id)).filter(|v| !v.is_empty()).collect();
        for v in ["delete", "rename", "properties"] {
            assert!(verbs.iter().any(|x| x == v), "missing {v} in {verbs:?}");
        }
    }

    #[test]
    fn background_menu_builds() {
        com::init_sta();
        let dir = tempfile::tempdir().unwrap();
        let built = build_menu(HWND::default(), &dir.path().to_string_lossy(), &[], false).unwrap();
        assert!(unsafe { GetMenuItemCount(Some(built.hmenu)) } > 0);
    }
}
