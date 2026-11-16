//! Opening items with ShellExecuteEx, and reading modifier key state.

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_CONTROL, VK_MENU, VK_SHIFT,
};
use windows::Win32::UI::Shell::{
    SEE_MASK_FLAG_NO_UI, SEE_MASK_IDLIST, SEE_MASK_INVOKEIDLIST, SHELLEXECUTEINFOW, ShellExecuteExW,
};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
use windows::core::PCWSTR;

use crate::com::{self, Pidl, err, wide};
use crate::types::Modifiers;

/// Opens each location with `verb` (`None` = default verb). `args` and `cwd` are passed through
/// (the caller expands environment variables in the settings text, before file names go in).
pub async fn open(
    locations: Vec<String>,
    verb: Option<String>,
    args: Option<String>,
    cwd: Option<String>,
    owner: isize,
) -> Result<(), String> {
    com::list_pool()
        .run(move || open_sync(&locations, verb.as_deref(), args.as_deref(), cwd.as_deref(), owner))
        .await?
}

fn open_sync(
    locations: &[String],
    verb: Option<&str>,
    args: Option<&str>,
    cwd: Option<&str>,
    owner: isize,
) -> Result<(), String> {
    let verb_w = verb.filter(|v| !v.is_empty()).map(wide);
    let args_w = args.filter(|v| !v.is_empty()).map(wide);
    let cwd_w = cwd.filter(|v| !v.is_empty()).map(wide);
    let ptr = |v: &Option<Vec<u16>>| v.as_ref().map_or(PCWSTR::null(), |w| PCWSTR(w.as_ptr()));

    // The default action shows the shell's own dialogs ("Open with..." for a type without an
    // app); a named verb reports failures through the returned error only.
    let quiet = if verb_w.is_some() { SEE_MASK_FLAG_NO_UI } else { Default::default() };

    let mut errors = Vec::new();
    for loc in locations {
        let result = if is_url(loc) {
            // A web address is not a shell item: hand it to the default browser as text.
            let file_w = wide(loc);
            let mut info = SHELLEXECUTEINFOW {
                cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
                fMask: SEE_MASK_FLAG_NO_UI,
                hwnd: HWND(owner as _),
                lpFile: PCWSTR(file_w.as_ptr()),
                nShow: SW_SHOWNORMAL.0,
                ..Default::default()
            };
            unsafe { ShellExecuteExW(&mut info) }
        } else {
            Pidl::from_parsing(loc).and_then(|pidl| {
                let mut info = SHELLEXECUTEINFOW {
                    cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
                    fMask: SEE_MASK_IDLIST | SEE_MASK_INVOKEIDLIST | quiet,
                    hwnd: HWND(owner as _),
                    lpVerb: ptr(&verb_w),
                    lpParameters: ptr(&args_w),
                    lpDirectory: ptr(&cwd_w),
                    nShow: SW_SHOWNORMAL.0,
                    lpIDList: pidl.as_ptr() as *mut _,
                    ..Default::default()
                };
                unsafe { ShellExecuteExW(&mut info) }
            })
        };
        if let Err(e) = result {
            errors.push(format!("{loc}: {}", err(e)));
        }
    }
    if errors.is_empty() { Ok(()) } else { Err(errors.join("\n")) }
}

/// `http://` / `https://` addresses (menu items like "open the web site").
pub fn is_url(s: &str) -> bool {
    let l = s.to_ascii_lowercase();
    l.starts_with("http://") || l.starts_with("https://")
}

/// Current state of Ctrl / Shift / Alt (GetAsyncKeyState).
pub fn key_state() -> Modifiers {
    let down = |vk: i32| (unsafe { GetAsyncKeyState(vk) } as u16 & 0x8000) != 0;
    Modifiers {
        ctrl: down(VK_CONTROL.0 as i32),
        shift: down(VK_SHIFT.0 as i32),
        alt: down(VK_MENU.0 as i32),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_are_recognised() {
        assert!(is_url("https://github.com/khlizard/vesta"));
        assert!(is_url("HTTP://example.com"));
        assert!(!is_url("C:\\https\\x"));
        assert!(!is_url("ftp://example.com"));
    }

    #[test]
    fn key_state_does_not_panic() {
        let _ = key_state();
    }

    #[test]
    fn args_environment_variables_expand() {
        let root = std::env::var("SystemRoot").unwrap();
        assert_eq!(crate::location::expand_env("--dir=\"%SystemRoot%\\x\" {a}"), format!("--dir=\"{root}\\x\" {{a}}"));
    }
    #[test]
    fn open_nonexistent_path_is_error() {
        let r = com::list_pool().run_blocking(|| {
            open_sync(&["C:\\no-such-dir-avesta-test\\nofile.txt".to_string()], None, None, None, 0)
        });
        assert!(r.unwrap().is_err());
    }
}
