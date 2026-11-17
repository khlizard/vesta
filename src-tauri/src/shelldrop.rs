//! A right-button drop, replayed on the Shell's own drop target of the folder: the Shell shows
//! its menu (copy / move / shortcut, plus the items of shell extensions) and carries out the
//! choice. Spec: docs/spec/fileops.md
//!
//! This is not part of the window's drop target (`crate::droptarget`): that one only tells the
//! frontend that a drag was dropped with the right button, and the frontend then asks for this.

use windows::Win32::Foundation::{HWND, POINT, POINTL};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::System::Ole::{DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_MOVE, IDropTarget};
use windows::Win32::System::SystemServices::{MK_RBUTTON, MODIFIERKEYS_FLAGS};
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
    use windows::Win32::System::Ole::DROPEFFECT_NONE;

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
