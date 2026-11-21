//! Avesta's names for places (`HOME`, `DRIVES`, `~` ...) and the text clean-up of what the user
//! typed. Spec: docs/spec/navigation.md「場所の書き方」

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use windows::Win32::System::Environment::ExpandEnvironmentStringsW;
use windows::Win32::UI::Shell::{
    FOLDERID_Desktop, FOLDERID_Documents, FOLDERID_Downloads, FOLDERID_Music, FOLDERID_Pictures, FOLDERID_Profile,
    FOLDERID_ProgramFiles, FOLDERID_System, FOLDERID_Videos, FOLDERID_Windows, KF_FLAG_DEFAULT,
    SHGetKnownFolderPath,
};
use windows::core::{GUID, PCWSTR};

use super::{CONTROL_PANEL, DESKTOP, NETWORK, RECYCLE_BIN, THIS_PC};
use crate::com::{err, from_wide_buf, take_cotaskmem_string, wide};

static AVESTA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Sets the folder the `AVESTA` alias points to (the app config dir, parent of `usr/`).
pub fn set_avesta_dir(path: PathBuf) {
    let _ = AVESTA_DIR.set(path);
}

enum AliasTarget {
    Known(GUID),
    Fixed(&'static str),
    Root,
    Avesta,
}

fn alias_target(name: &str) -> Option<AliasTarget> {
    use AliasTarget::*;
    Some(match name {
        "DESKTOP" => Root,
        "DESKTOPDIRECTORY" => Known(FOLDERID_Desktop),
        "DRIVES" | "DRIVE" => Fixed(THIS_PC),
        "HOME" | "MYDOCUMENTS" | "PERSONAL" => Known(FOLDERID_Documents),
        "MYMUSIC" => Known(FOLDERID_Music),
        "MYPICTURES" | "MYPICTURE" => Known(FOLDERID_Pictures),
        "MYVIDEO" | "MYVIDEOS" => Known(FOLDERID_Videos),
        "DOWNLOADS" => Known(FOLDERID_Downloads),
        "PROFILE" | "~" => Known(FOLDERID_Profile),
        "CONTROLS" | "CONTROLPANEL" | "CONTROL" => Fixed(CONTROL_PANEL),
        "BITBUCKET" | "RECYCLEBIN" | "TRASH" => Fixed(RECYCLE_BIN),
        "NETWORK" | "NETHOOD" => Fixed(NETWORK),
        "PROGRAM_FILES" => Known(FOLDERID_ProgramFiles),
        "SYSTEM" => Known(FOLDERID_System),
        "WINDOWS" => Known(FOLDERID_Windows),
        "AVESTA" | "VESTA" => Avesta,
        _ => return None,
    })
}

fn known_folder_path(id: &GUID) -> Result<String, String> {
    let p = unsafe { SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None) }.map_err(err)?;
    Ok(take_cotaskmem_string(p))
}

pub(crate) fn expand_env(s: &str) -> String {
    if !s.contains('%') {
        return s.to_string();
    }
    let w = wide(s);
    let n = unsafe { ExpandEnvironmentStringsW(PCWSTR(w.as_ptr()), None) };
    if n == 0 {
        return s.to_string();
    }
    let mut buf = vec![0u16; n as usize];
    let n2 = unsafe { ExpandEnvironmentStringsW(PCWSTR(w.as_ptr()), Some(&mut buf)) };
    if n2 == 0 {
        return s.to_string();
    }
    from_wide_buf(&buf)
}

/// Text normalisation and alias expansion. Returns the string to hand to the Shell,
/// or `DESKTOP` for the namespace root.
pub(super) fn normalize(input: &str) -> Result<String, String> {
    normalize_with(input, expand_env, known_folder_path, AVESTA_DIR.get().map(PathBuf::as_path))
}

/// `normalize` with what it asks Windows for handed in: the expansion of `%NAME%`, the path of
/// a known folder, and the folder of the `AVESTA` alias (`None` until it is set).
fn normalize_with(
    input: &str,
    expand_env: impl Fn(&str) -> String,
    known_folder: impl Fn(&GUID) -> Result<String, String>,
    avesta_dir: Option<&Path>,
) -> Result<String, String> {
    let mut s = input.trim().trim_matches('"').trim().replace('/', "\\");
    if s.is_empty() {
        return Err("場所が空です".into());
    }
    s = expand_env(&s);
    let b = s.as_bytes();
    if b.len() == 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        s.push('\\');
    }
    let (head, rest) = match s.split_once('\\') {
        Some((h, r)) => (h, r),
        None => (s.as_str(), ""),
    };
    if let Some(target) = alias_target(&head.to_ascii_uppercase()) {
        let rest = rest.trim_matches('\\');
        let base = match target {
            AliasTarget::Root => {
                if rest.is_empty() {
                    return Ok(DESKTOP.into());
                }
                known_folder(&FOLDERID_Desktop)?
            }
            AliasTarget::Known(id) => known_folder(&id)?,
            AliasTarget::Fixed(p) => p.to_string(),
            AliasTarget::Avesta => avesta_dir
                .ok_or("設定フォルダの場所がまだ決まっていません")?
                .to_string_lossy()
                .into_owned(),
        };
        return Ok(if rest.is_empty() {
            base
        } else {
            format!("{}\\{}", base.trim_end_matches('\\'), rest)
        });
    }
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Known folders of a made-up PC.
    fn known(id: &GUID) -> Result<String, String> {
        let folders = [
            (FOLDERID_Windows, r"C:\Windows"),
            (FOLDERID_Profile, r"C:\Users\a"),
            (FOLDERID_Desktop, r"C:\Users\a\Desktop"),
            (FOLDERID_Documents, r"D:\"),
        ];
        folders.iter().find(|(known, _)| known == id).map(|(_, p)| p.to_string()).ok_or("no such folder".into())
    }

    /// `%X%` is `D:\x`; nothing else is a variable.
    fn env(s: &str) -> String {
        s.replace("%X%", r"D:\x")
    }

    fn norm(input: &str) -> Result<String, String> {
        normalize_with(input, env, known, Some(Path::new(r"C:\Users\a\AppData\Roaming\vesta")))
    }

    #[test]
    fn text_is_cleaned_up() {
        assert_eq!(norm("  \" C:/Windows/System32 \"  ").unwrap(), r"C:\Windows\System32");
        assert_eq!(norm(r"\\srv\share/a").unwrap(), r"\\srv\share\a");
        // A bare drive is its root; a path is left as it is.
        assert_eq!(norm("c:").unwrap(), r"c:\");
        assert_eq!(norm(r"C:\").unwrap(), r"C:\");
        assert_eq!(norm(r"C:\a\").unwrap(), r"C:\a\");
        assert_eq!(norm("::{20D04FE0-3AEA-1069-A2D8-08002B30309D}").unwrap(), THIS_PC);
        assert_eq!(norm("").unwrap_err(), "場所が空です");
        assert_eq!(norm("  \"\"  ").unwrap_err(), "場所が空です");
    }

    #[test]
    fn environment_variables_are_expanded_first() {
        assert_eq!(norm("%X%").unwrap(), r"D:\x");
        assert_eq!(norm("\"%X%/sub\"").unwrap(), r"D:\x\sub");
        assert_eq!(norm("%NOPE%").unwrap(), "%NOPE%");
        // What a variable expands to can be an alias or a bare drive.
        let alias_env = |s: &str| s.replace("%W%", "windows").replace("%D%", "E:");
        let with = |input: &str| normalize_with(input, alias_env, known, None);
        assert_eq!(with(r"%W%\Fonts").unwrap(), r"C:\Windows\Fonts");
        assert_eq!(with("%D%").unwrap(), r"E:\");
    }

    #[test]
    fn aliases_are_the_first_component_in_any_case() {
        assert_eq!(norm("windows").unwrap(), r"C:\Windows");
        assert_eq!(norm(r"WINDOWS\System32").unwrap(), r"C:\Windows\System32");
        assert_eq!(norm("Windows/System32/").unwrap(), r"C:\Windows\System32");
        // Only as a whole component, and only the first one.
        assert_eq!(norm("windows2").unwrap(), "windows2");
        assert_eq!(norm(r"C:\windows").unwrap(), r"C:\windows");
        // `~` is the profile folder.
        assert_eq!(norm("~").unwrap(), r"C:\Users\a");
        assert_eq!(norm("~/AppData").unwrap(), r"C:\Users\a\AppData");
        assert_eq!(norm(r"~\AppData\").unwrap(), r"C:\Users\a\AppData");
        assert_eq!(norm("~nobody").unwrap(), "~nobody");
        // A base that ends in a separator (a drive root) gets one separator, not two.
        assert_eq!(norm("home").unwrap(), r"D:\");
        assert_eq!(norm(r"HOME\notes").unwrap(), r"D:\notes");
    }

    #[test]
    fn desktop_is_the_namespace_root_and_below_it_the_desktop_folder() {
        assert_eq!(norm("desktop").unwrap(), DESKTOP);
        assert_eq!(norm(r"Desktop\").unwrap(), DESKTOP);
        assert_eq!(norm(r"DESKTOP\a.txt").unwrap(), r"C:\Users\a\Desktop\a.txt");
        assert_eq!(norm("desktopdirectory").unwrap(), r"C:\Users\a\Desktop");
    }

    #[test]
    fn virtual_folders_and_the_app_folder() {
        assert_eq!(norm("drives").unwrap(), THIS_PC);
        assert_eq!(norm("Trash").unwrap(), RECYCLE_BIN);
        assert_eq!(norm("NETHOOD").unwrap(), NETWORK);
        assert_eq!(norm("controls").unwrap(), CONTROL_PANEL);
        assert_eq!(norm("AVESTA").unwrap(), r"C:\Users\a\AppData\Roaming\vesta");
        assert_eq!(norm(r"vesta\usr").unwrap(), r"C:\Users\a\AppData\Roaming\vesta\usr");
        // Before the app has set its folder.
        let early = normalize_with("AVESTA", env, known, None).unwrap_err();
        assert!(early.contains("まだ決まっていません"), "{early}");
        // A known folder Windows cannot name is an error, not a path.
        assert_eq!(norm("mymusic").unwrap_err(), "no such folder");
    }
}
