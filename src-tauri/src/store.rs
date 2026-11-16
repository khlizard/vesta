//! App data folders: `usr/` (user-edited XML) and `var/` (state written by the app).
//! Spec: docs/spec/config.md「置き場所」

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

fn base_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

pub fn var_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = base_dir(app)?.join("var");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn usr_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = base_dir(app)?.join("usr");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// State names are plain identifiers; reject anything that could escape `var/`.
fn check_name(name: &str) -> Result<(), String> {
    if !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        Ok(())
    } else {
        Err(format!("invalid state name: {name}"))
    }
}

/// Reads `var/<name>.json`. `None` when it does not exist.
pub fn read_state(app: &AppHandle, name: &str) -> Result<Option<String>, String> {
    check_name(name)?;
    let path = var_dir(app)?.join(format!("{name}.json"));
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Writes `var/<name>.json` atomically (temp file + rename).
pub fn write_state(app: &AppHandle, name: &str, json: &str) -> Result<(), String> {
    check_name(name)?;
    let dir = var_dir(app)?;
    let tmp = dir.join(format!("{name}.json.tmp"));
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join(format!("{name}.json"))).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::check_name;

    #[test]
    fn state_names_cannot_escape() {
        assert!(check_name("session").is_ok());
        assert!(check_name("folder-views_2").is_ok());
        assert!(check_name("").is_err());
        assert!(check_name("../x").is_err());
        assert!(check_name("a\\b").is_err());
    }
}
