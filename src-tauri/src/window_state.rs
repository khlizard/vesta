//! Remembering the main window's position, size and maximized state.
//! The frontend stores a `window` key in `var/session.json`; `restore` applies it at startup.

use serde::{Deserialize, Serialize};
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowPlacement, SWP_NOACTIVATE, SWP_NOZORDER, SetWindowPos, WINDOWPLACEMENT,
};

use crate::com;

const SW_SHOWMINIMIZED: u32 = 2;
const SW_SHOWMAXIMIZED: u32 = 3;
const WPF_RESTORETOMAXIMIZED: u32 = 2;
const MONITORINFOF_PRIMARY: u32 = 1;

const MIN_WIDTH: i32 = 200;
const MIN_HEIGHT: i32 = 100;
const STRIP_HEIGHT: i32 = 32;
const STRIP_MIN_WIDTH: i32 = 64;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Placement {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub maximized: bool,
}

impl Rect {
    fn right(&self) -> i32 {
        self.x + self.width
    }
    fn bottom(&self) -> i32 {
        self.y + self.height
    }
}

/// Reads the `window` key of the session JSON.
pub fn parse(session_json: &str) -> Option<Placement> {
    let value: serde_json::Value = serde_json::from_str(session_json).ok()?;
    let p: Placement = serde_json::from_value(value.get("window")?.clone()).ok()?;
    (p.width >= MIN_WIDTH && p.height >= MIN_HEIGHT).then_some(p)
}

/// Builds a placement from `GetWindowPlacement` values; `normal` is in workspace coordinates.
pub fn from_win32(show_cmd: u32, flags: u32, normal: Rect, work_offset: (i32, i32)) -> Placement {
    let maximized = show_cmd == SW_SHOWMAXIMIZED
        || (show_cmd == SW_SHOWMINIMIZED && flags & WPF_RESTORETOMAXIMIZED != 0);
    Placement {
        x: normal.x + work_offset.0,
        y: normal.y + work_offset.1,
        width: normal.width,
        height: normal.height,
        maximized,
    }
}

fn overlap(a: &Rect, b: &Rect) -> (i32, i32) {
    let w = a.right().min(b.right()) - a.x.max(b.x);
    let h = a.bottom().min(b.bottom()) - a.y.max(b.y);
    (w.max(0), h.max(0))
}

/// Keeps the window reachable: unchanged if its title strip is visible on some work area,
/// otherwise moved (and shrunk if needed) into the best-overlapping work area.
pub fn fit(rect: Rect, work_areas: &[Rect]) -> Rect {
    let Some(first) = work_areas.first() else {
        return rect;
    };
    let strip = Rect { height: STRIP_HEIGHT, ..rect };
    let visible = work_areas.iter().any(|wa| {
        let (w, h) = overlap(&strip, wa);
        w >= STRIP_MIN_WIDTH && h >= STRIP_HEIGHT
    });
    if visible {
        return rect;
    }
    let mut best = first;
    let mut best_area = 0i64;
    for wa in work_areas {
        let (w, h) = overlap(&rect, wa);
        let area = w as i64 * h as i64;
        if area > best_area {
            best = wa;
            best_area = area;
        }
    }
    let width = rect.width.min(best.width);
    let height = rect.height.min(best.height);
    Rect {
        x: rect.x.clamp(best.x, best.right() - width),
        y: rect.y.clamp(best.y, best.bottom() - height),
        width,
        height,
    }
}

fn to_rect(r: &RECT) -> Rect {
    Rect { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }
}

/// (primary?, monitor rect, work rect)
type MonitorEntry = (bool, Rect, Rect);

unsafe extern "system" fn monitor_proc(
    monitor: HMONITOR,
    _hdc: HDC,
    _rect: *mut RECT,
    data: LPARAM,
) -> windows::core::BOOL {
    let list = unsafe { &mut *(data.0 as *mut Vec<MonitorEntry>) };
    let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
    if unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        list.push((
            info.dwFlags & MONITORINFOF_PRIMARY != 0,
            to_rect(&info.rcMonitor),
            to_rect(&info.rcWork),
        ));
    }
    true.into()
}

fn monitors() -> Vec<MonitorEntry> {
    let mut list: Vec<MonitorEntry> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(monitor_proc), LPARAM(&mut list as *mut _ as isize));
    }
    list
}

/// Work areas of all monitors, primary first.
fn work_areas() -> Vec<Rect> {
    let mut list = monitors();
    list.sort_by_key(|m| !m.0);
    list.into_iter().map(|m| m.2).collect()
}

fn capture(hwnd: HWND) -> Result<Placement, String> {
    let mut wp = WINDOWPLACEMENT { length: size_of::<WINDOWPLACEMENT>() as u32, ..Default::default() };
    unsafe { GetWindowPlacement(hwnd, &mut wp) }.map_err(com::err)?;
    // GetWindowPlacement reports workspace coordinates (relative to the primary work area).
    let offset = monitors()
        .iter()
        .find(|m| m.0)
        .map(|m| (m.2.x - m.1.x, m.2.y - m.1.y))
        .unwrap_or((0, 0));
    Ok(from_win32(wp.showCmd as u32, wp.flags.0, to_rect(&wp.rcNormalPosition), offset))
}

fn set_rect(hwnd: HWND, r: Rect) {
    // The first call may move the window to a monitor with another DPI and rescale it;
    // the second sets the exact rect.
    for _ in 0..2 {
        let _ = unsafe {
            SetWindowPos(hwnd, None, r.x, r.y, r.width, r.height, SWP_NOZORDER | SWP_NOACTIVATE)
        };
    }
}

pub fn placement(window: &tauri::WebviewWindow) -> Result<Placement, String> {
    capture(com::hwnd_of(window)?)
}

/// Applies the stored placement to the (hidden) window. Every failure is ignored.
pub fn restore(window: &tauri::WebviewWindow, session_json: Option<&str>) {
    let Some(p) = session_json.and_then(parse) else {
        return;
    };
    let Ok(hwnd) = com::hwnd_of(window) else {
        return;
    };
    let rect = fit(Rect { x: p.x, y: p.y, width: p.width, height: p.height }, &work_areas());
    set_rect(hwnd, rect);
    if p.maximized {
        let _ = window.maximize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(x: i32, y: i32, width: i32, height: i32) -> Rect {
        Rect { x, y, width, height }
    }

    #[test]
    fn parse_valid() {
        let j = r#"{"tabs":[],"window":{"x":-10,"y":80,"width":1600,"height":900,"maximized":true}}"#;
        assert_eq!(
            parse(j),
            Some(Placement { x: -10, y: 80, width: 1600, height: 900, maximized: true })
        );
    }

    #[test]
    fn parse_missing_key() {
        assert_eq!(parse(r#"{"tabs":[]}"#), None);
    }

    #[test]
    fn parse_corrupt() {
        assert_eq!(parse("{not json"), None);
        assert_eq!(parse(""), None);
    }

    #[test]
    fn parse_wrong_types() {
        assert_eq!(parse(r#"{"window":{"x":"1","y":0,"width":800,"height":600,"maximized":false}}"#), None);
        assert_eq!(parse(r#"{"window":{"x":1,"y":0,"width":800,"height":600}}"#), None);
        assert_eq!(parse(r#"{"window":5}"#), None);
    }

    #[test]
    fn parse_too_small() {
        assert_eq!(parse(r#"{"window":{"x":0,"y":0,"width":199,"height":600,"maximized":false}}"#), None);
        assert_eq!(parse(r#"{"window":{"x":0,"y":0,"width":800,"height":99,"maximized":false}}"#), None);
        assert!(parse(r#"{"window":{"x":0,"y":0,"width":200,"height":100,"maximized":false}}"#).is_some());
    }

    #[test]
    fn parse_ignores_extra_keys() {
        let j = r#"{"window":{"x":1,"y":2,"width":800,"height":600,"maximized":false,"extra":1},"other":1}"#;
        assert_eq!(
            parse(j),
            Some(Placement { x: 1, y: 2, width: 800, height: 600, maximized: false })
        );
    }

    #[test]
    fn from_win32_cases() {
        let n = r(10, 20, 800, 600);
        assert!(!from_win32(1, 0, n, (0, 0)).maximized);
        assert!(from_win32(SW_SHOWMAXIMIZED, 0, n, (0, 0)).maximized);
        assert!(!from_win32(SW_SHOWMINIMIZED, 0, n, (0, 0)).maximized);
        assert!(from_win32(SW_SHOWMINIMIZED, WPF_RESTORETOMAXIMIZED, n, (0, 0)).maximized);
        let p = from_win32(1, 0, n, (0, 40));
        assert_eq!((p.x, p.y, p.width, p.height), (10, 60, 800, 600));
    }

    const PRIMARY: Rect = Rect { x: 0, y: 0, width: 1920, height: 1040 };

    #[test]
    fn fit_inside_unchanged() {
        let w = r(100, 100, 800, 600);
        assert_eq!(fit(w, &[PRIMARY]), w);
    }

    #[test]
    fn fit_strip_partly_off_right_unchanged() {
        let w = r(1800, 100, 800, 600);
        assert_eq!(fit(w, &[PRIMARY]), w);
    }

    #[test]
    fn fit_monitor_gone_moves_to_primary() {
        let w = r(2500, 100, 800, 600);
        assert_eq!(fit(w, &[PRIMARY]), r(1120, 100, 800, 600));
    }

    #[test]
    fn fit_larger_than_work_area_shrinks() {
        assert_eq!(fit(r(-50, -20, 3000, 2000), &[PRIMARY]), PRIMARY);
    }

    #[test]
    fn fit_title_bar_above_top_clamped() {
        assert_eq!(fit(r(100, -200, 800, 600), &[PRIMARY]), r(100, 0, 800, 600));
    }

    #[test]
    fn fit_secondary_negative_coordinates() {
        let second = r(-1280, 0, 1280, 1024);
        let w = r(-1200, 50, 800, 600);
        assert_eq!(fit(w, &[PRIMARY, second]), w);
        // Title bar above the secondary monitor: clamped into it, not moved to primary.
        assert_eq!(fit(r(-1200, -300, 800, 600), &[PRIMARY, second]), r(-1200, 0, 800, 600));
    }

    #[test]
    fn fit_empty_unchanged() {
        let w = r(5000, 5000, 800, 600);
        assert_eq!(fit(w, &[]), w);
    }
}
