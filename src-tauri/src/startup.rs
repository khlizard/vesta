//! Start-up helpers: paths from the command line, and a record of crashes.
//! Spec: docs/spec/ui.md「ウィンドウ」

use std::io::Write;
use std::path::{Path, PathBuf};

use windows::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
use windows::core::PCWSTR;

use crate::com::wide;

/// The folders and files to open from command-line arguments (without the program name).
/// Options (`-x`, `--x`: the installer passes some) are skipped; relative paths are taken
/// from `cwd`, the folder the command was run in.
pub fn paths_from_args(args: impl Iterator<Item = String>, cwd: &Path) -> Vec<String> {
    args.filter(|a| !a.is_empty() && !a.starts_with('-'))
        .map(|a| {
            let p = Path::new(&a);
            // Shell locations (`::{...}`, aliases) and absolute paths go through unchanged.
            if p.is_absolute() || a.starts_with("::") || !looks_relative(&a) {
                a
            } else {
                cwd.join(p).to_string_lossy().into_owned()
            }
        })
        .collect()
}

/// `.`, `..`, `sub\x`, `.\x`: something to resolve against the working folder. A bare word
/// such as `DESKTOP` is left alone (it may be a location alias).
fn looks_relative(a: &str) -> bool {
    a == "." || a == ".." || a.contains('\\') || a.contains('/')
}

/// With `panic = "abort"` a panic ends the process at once. Leave a trace first: a line in
/// `var/crash.log` and a message box, so the user (and a bug report) knows what happened.
pub fn install_panic_hook(var_dir: PathBuf) {
    std::panic::set_hook(Box::new(move |info| {
        let text = format!("Vesta {}: {info}", env!("CARGO_PKG_VERSION"));
        let _ = std::fs::create_dir_all(&var_dir);
        let log = var_dir.join("crash.log");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log) {
            let secs = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.as_secs());
            let _ = writeln!(f, "[{secs}] {text}");
        }
        let body = wide(&format!(
            "問題が起きたため Vesta を終了します。\n\n{text}\n\n記録: {}",
            log.display()
        ));
        let title = wide("Vesta");
        unsafe {
            MessageBoxW(None, PCWSTR(body.as_ptr()), PCWSTR(title.as_ptr()), MB_OK | MB_ICONERROR);
        }
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(args: &[&str]) -> Vec<String> {
        paths_from_args(args.iter().map(|s| s.to_string()), Path::new("C:\\work"))
    }

    #[test]
    fn keeps_absolute_paths_and_skips_options() {
        assert_eq!(run(&["C:\\a b\\c", "--veloapp-version", "-x", "\\\\srv\\share"]), vec![
            "C:\\a b\\c",
            "\\\\srv\\share"
        ]);
        assert!(run(&[]).is_empty());
    }

    #[test]
    fn resolves_relative_paths_against_the_working_folder() {
        assert_eq!(run(&["."]), vec!["C:\\work\\."]);
        assert_eq!(run(&["sub\\x"]), vec!["C:\\work\\sub\\x"]);
    }

    #[test]
    fn leaves_aliases_and_shell_locations() {
        assert_eq!(run(&["DESKTOP", "::{645FF040-5081-101B-9F08-00AA002F954E}"]), vec![
            "DESKTOP",
            "::{645FF040-5081-101B-9F08-00AA002F954E}"
        ]);
    }
}
