//! Drops replayed on the Shell's own drop targets. Spec: docs/spec/fileops.md
//!
//! - A right-button drop on a folder: the Shell shows its menu (copy / move / shortcut, plus the
//!   items of shell extensions) and carries out the choice.
//! - A drop on a program or a shortcut: the Shell does what Explorer does for that item (a
//!   program is started with the dropped files as its arguments).
//!
//! This is not part of the window's drop target (`crate::droptarget`): that one only tells the
//! frontend that a drag was dropped with the right button, and the frontend then asks for this.

use windows::Win32::Foundation::{HWND, POINT, POINTL};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::System::Com::IBindCtx;
use windows::Win32::System::Ole::{
    DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_MOVE, DROPEFFECT_NONE, IDropTarget,
};
use windows::Win32::System::SystemServices::{
    MK_CONTROL, MK_LBUTTON, MK_RBUTTON, MK_SHIFT, MODIFIERKEYS_FLAGS,
};
use windows::Win32::UI::Shell::BHID_SFUIObject;
use windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow;

use crate::com::{self, Hwnd};
use crate::dataobject;

/// The Shell's own drop target of `folder`, as Explorer uses for its folder windows.
fn shell_drop_target(hwnd: HWND, folder: &str) -> Result<IDropTarget, String> {
    let sf = crate::context_menu::shell_folder(folder)?;
    unsafe { sf.CreateViewObject::<IDropTarget>(hwnd) }.map_err(com::err)
}

/// Replays a right-button drop of `sources` on the Shell's drop target of `folder`. The Shell
/// shows its menu at `pt` (screen): copy / move / shortcut plus the items of drag-and-drop
/// handler extensions (FastCopy, archivers), and carries out the choice itself.
fn right_drop_blocking(hwnd: HWND, sources: &[String], folder: &str, pt: POINT) -> Result<(), String> {
    let data = dataobject::data_object(sources).map_err(|e| e.plain("no items to drag"))?;
    let target = shell_drop_target(hwnd, folder)?;
    let at = POINTL { x: pt.x, y: pt.y };
    let allowed = DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK;
    unsafe {
        // Without this the menu does not close when the user clicks elsewhere.
        let _ = SetForegroundWindow(hwnd);
        let mut effect = allowed;
        target.DragEnter(&data, MK_RBUTTON, at, &mut effect).map_err(com::err)?;
        let mut effect = allowed;
        let _ = target.DragOver(MK_RBUTTON, at, &mut effect);
        // As in a real drag: the button is up by the time of the drop; the target remembers it.
        let mut effect = allowed;
        target.Drop(&data, MODIFIERKEYS_FLAGS(0), at, &mut effect).map_err(com::err)
    }
}

/// The Shell's drop target of one item (a program, a shortcut...), as Explorer uses when
/// something is dropped on the item in a folder window.
fn item_drop_target(item: &str) -> Result<IDropTarget, String> {
    let item = com::shell_item(item).map_err(com::err)?;
    unsafe { item.BindToHandler::<_, IDropTarget>(None::<&IBindCtx>, &BHID_SFUIObject) }
        .map_err(|_| NOT_A_TARGET.to_string())
}

const NOT_A_TARGET: &str = "この項目にはドロップできません";

/// The mouse button and modifier keys of a drop, as drop targets are told them.
fn drop_keys(right_button: bool) -> MODIFIERKEYS_FLAGS {
    let held = crate::launch::key_state();
    let mut keys = if right_button { MK_RBUTTON } else { MK_LBUTTON };
    if held.ctrl {
        keys |= MK_CONTROL;
    }
    if held.shift {
        keys |= MK_SHIFT;
    }
    // Alt has no MK_ flag of its own; drop targets know it as this value (MK_ALT in the SDK).
    if held.alt {
        keys |= MODIFIERKEYS_FLAGS(0x20);
    }
    keys
}

/// Replays a drop of `sources` on the Shell's drop target of `item`, at `pt` (screen).
fn drop_on_item_blocking(hwnd: HWND, sources: &[String], item: &str, pt: POINT, right_button: bool) -> Result<(), String> {
    let data = dataobject::data_object(sources).map_err(|e| e.plain("no items to drag"))?;
    let target = item_drop_target(item)?;
    let at = POINTL { x: pt.x, y: pt.y };
    let allowed = DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK;
    let keys = drop_keys(right_button);
    unsafe {
        // A menu the Shell may show (right button) closes when the user clicks elsewhere.
        let _ = SetForegroundWindow(hwnd);
        let mut effect = allowed;
        target.DragEnter(&data, keys, at, &mut effect).map_err(com::err)?;
        if effect == DROPEFFECT_NONE {
            // The item is there but takes nothing (a shortcut whose target is gone).
            let _ = target.DragLeave();
            return Err(NOT_A_TARGET.into());
        }
        let mut effect = allowed;
        let _ = target.DragOver(keys, at, &mut effect);
        // As in a real drag: the button is up by the time of the drop; the target remembers it.
        let released = MODIFIERKEYS_FLAGS(keys.0 & !(MK_LBUTTON.0 | MK_RBUTTON.0));
        let mut effect = allowed;
        target.Drop(&data, released, at, &mut effect).map_err(com::err)
    }
}

/// Drops `sources` on `item` (a program, a shortcut...) the way Explorer would. (`x`, `y`) is
/// the drop position in physical pixels inside the window, as in the `drag-drop` event.
pub async fn drop_on_item(
    window: tauri::WebviewWindow,
    sources: Vec<String>,
    item: String,
    x: f64,
    y: f64,
    right_button: bool,
) -> Result<(), String> {
    let hwnd = Hwnd::of(&window)?;
    com::on_main(&window, "drop on item", move || {
        let hwnd = hwnd.get();
        let mut pt = POINT { x: x.round() as i32, y: y.round() as i32 };
        let _ = unsafe { ClientToScreen(hwnd, &mut pt) };
        drop_on_item_blocking(hwnd, &sources, &item, pt, right_button)
    })
    .await?
}

/// Shows the Shell's right-button drop menu for `sources` dropped on `folder` and lets the Shell
/// do what is chosen. (`x`, `y`) is the drop position in physical pixels inside the window, as
/// in the `drag-drop` event.
pub async fn right_drop(
    window: tauri::WebviewWindow,
    sources: Vec<String>,
    folder: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let hwnd = Hwnd::of(&window)?;
    com::on_main(&window, "drop menu", move || {
        let hwnd = hwnd.get();
        let mut pt = POINT { x: x.round() as i32, y: y.round() as i32 };
        let _ = unsafe { ClientToScreen(hwnd, &mut pt) };
        right_drop_blocking(hwnd, &sources, &folder, pt)
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The first half of a drop on a program (the drop itself would run it).
    #[test]
    fn the_drop_target_of_a_batch_file_takes_files_and_a_text_file_is_no_target() {
        com::init_sta();
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        let bat = dir.path().join("run.bat");
        std::fs::write(&file, b"x").unwrap();
        std::fs::write(&bat, b"@echo off\r\n").unwrap();
        let data = dataobject::data_object(&[file.to_string_lossy().into_owned()]).unwrap();
        let target = item_drop_target(&bat.to_string_lossy()).unwrap();
        let mut effect = DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK;
        unsafe {
            target.DragEnter(&data, MK_LBUTTON, POINTL { x: 0, y: 0 }, &mut effect).unwrap();
            target.DragLeave().unwrap();
        }
        assert_ne!(effect, DROPEFFECT_NONE);

        // Plain data files have no drop target, or one that takes nothing.
        let takes = match item_drop_target(&file.to_string_lossy()) {
            Err(_) => false,
            Ok(target) => {
                let mut effect = DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK;
                let entered = unsafe { target.DragEnter(&data, MK_LBUTTON, POINTL { x: 0, y: 0 }, &mut effect) };
                let _ = unsafe { target.DragLeave() };
                entered.is_ok() && effect != DROPEFFECT_NONE
            }
        };
        assert!(!takes);
    }

    /// The first half of a right-button drop (the drop itself would open the menu).
    #[test]
    fn the_shell_drop_target_of_a_folder_takes_files() {
        com::init_sta();
        let from = tempfile::tempdir().unwrap();
        let to = tempfile::tempdir().unwrap();
        let file = from.path().join("a.txt");
        std::fs::write(&file, b"x").unwrap();
        let data = dataobject::data_object(&[file.to_string_lossy().into_owned()]).unwrap();
        let target = shell_drop_target(HWND::default(), &to.path().to_string_lossy()).unwrap();
        let mut effect = DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK;
        unsafe {
            target.DragEnter(&data, MK_RBUTTON, POINTL { x: 0, y: 0 }, &mut effect).unwrap();
            target.DragLeave().unwrap();
        }
        assert_ne!(effect, DROPEFFECT_NONE);
    }
}
