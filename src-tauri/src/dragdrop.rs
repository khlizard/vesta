//! Dragging items out of the window (SHDoDragDrop with COPY | MOVE | LINK).

use std::sync::Mutex;

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Ole::{DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_MOVE};
use windows::Win32::UI::Shell::{DefSubclassProc, SHDoDragDrop};
use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_APP};

use crate::com;
use crate::dataobject;

fn effect_name(effect: DROPEFFECT) -> &'static str {
    if effect.0 & DROPEFFECT_MOVE.0 != 0 {
        "move"
    } else if effect.0 & DROPEFFECT_COPY.0 != 0 {
        "copy"
    } else if effect.0 & DROPEFFECT_LINK.0 != 0 {
        "link"
    } else {
        "none"
    }
}

fn drag_blocking(hwnd: HWND, locations: &[String]) -> Result<String, String> {
    let data = dataobject::data_object(locations).map_err(|e| e.plain("no items to drag"))?;
    let effect = unsafe {
        SHDoDragDrop(
            Some(hwnd),
            &data,
            None,
            DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK,
        )
    };
    // A failure here (e.g. button already released) means nothing was dropped.
    Ok(match effect {
        Ok(e) => effect_name(e).to_string(),
        Err(_) => "none".to_string(),
    })
}

// The drag loop must not run inside a tao event callback (`run_on_main_thread`): tao buffers the
// events that arrive while a callback runs, so our own window would get the drag enter/over events
// only after the drop and could not highlight the drop target. Instead the request is posted to the
// main window and run from its subclass procedure, outside tao's callbacks.

const SUBCLASS_ID: usize = 0x4156_4444; // "AVDD"
const WM_APP_DRAG: u32 = WM_APP + 0x41;

type Reply = tokio::sync::oneshot::Sender<Result<String, String>>;

static PENDING: Mutex<Option<(Vec<String>, Reply)>> = Mutex::new(None);

/// Installs the window subclass that runs posted drags. Call on the main thread.
pub fn install(window: &tauri::WebviewWindow) -> Result<(), String> {
    com::subclass(window, subclass_proc, SUBCLASS_ID)
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if msg == WM_APP_DRAG {
        let pending = com::lock(&PENDING).take();
        if let Some((locations, reply)) = pending {
            let _ = reply.send(drag_blocking(hwnd, &locations));
        }
        return LRESULT(0);
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

/// Starts a native drag of `locations`. Must be called while the left button is down.
/// Returns the effect chosen by the drop target: "none", "copy", "move" or "link".
pub async fn start_drag(window: tauri::WebviewWindow, locations: Vec<String>) -> Result<String, String> {
    let hwnd = com::hwnd_of(&window)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    // A request that never ran (should not happen) is answered by dropping its sender.
    *com::lock(&PENDING) = Some((locations, tx));
    unsafe { PostMessageW(Some(hwnd), WM_APP_DRAG, WPARAM(0), LPARAM(0)) }.map_err(com::err)?;
    rx.await.map_err(|_| "drag was dropped".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effect_names() {
        assert_eq!(effect_name(DROPEFFECT(0)), "none");
        assert_eq!(effect_name(DROPEFFECT_COPY | DROPEFFECT_MOVE), "move");
        assert_eq!(effect_name(DROPEFFECT_COPY), "copy");
        assert_eq!(effect_name(DROPEFFECT_LINK), "link");
    }
}
