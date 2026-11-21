//! `var/vesta.log`: problems that do not stop the app. A release build has no console
//! (`windows_subsystem = "windows"`), so text written to stderr goes nowhere.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const FILE_NAME: &str = "vesta.log";
/// The log is started anew once it is larger than this, so it cannot grow without end.
const MAX_BYTES: u64 = 1024 * 1024;

static DIR: OnceLock<PathBuf> = OnceLock::new();

/// Sets the folder the log is written in (`var/`). Lines logged before this are not kept.
pub fn set_dir(var_dir: PathBuf) {
    let _ = DIR.set(var_dir);
}

/// Appends one line to the log. Never fails and never panics: a problem with the log itself
/// has nowhere to be reported.
pub fn line(text: &str) {
    #[cfg(debug_assertions)]
    eprintln!("{text}");
    if let Some(dir) = DIR.get() {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());
        let _ = append(
            &dir.join(FILE_NAME),
            &format!("[{secs}] Vesta {}: {text}", env!("CARGO_PKG_VERSION")),
            MAX_BYTES,
        );
    }
}

/// Appends `line` to `file`, emptying the file first when it is already over `max_bytes`.
fn append(file: &Path, line: &str, max_bytes: u64) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let full = std::fs::metadata(file).is_ok_and(|m| m.len() > max_bytes);
    let mut options = std::fs::OpenOptions::new();
    if full {
        options.write(true).truncate(true);
    } else {
        options.append(true);
    }
    let mut f = options.create(true).open(file)?;
    // One line whatever the text holds.
    writeln!(f, "{}", line.replace(['\r', '\n'], " "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_are_appended_and_the_folder_is_made() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("var").join("vesta.log");
        append(&file, "one", 100).unwrap();
        append(&file, "two\r\nthree", 100).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "one\ntwo  three\n");
    }

    #[test]
    fn a_log_over_the_limit_starts_anew() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("vesta.log");
        append(&file, "0123456789", 10).unwrap();
        // 11 bytes with the line end: over the limit, so the next line replaces it.
        append(&file, "new", 10).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "new\n");
        append(&file, "more", 10).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "new\nmore\n");
    }

    #[test]
    fn logging_without_a_folder_does_nothing() {
        // `DIR` is not set in tests: this must simply return.
        line("nothing to write to");
    }
}
