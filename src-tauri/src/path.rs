//! Text handling of paths, locations and file names. No COM and no disk access here, so every
//! function can be tested as it is.

use crate::location::DESKTOP;

/// The namespace root, however it is written (`DESKTOP`, `desktop`).
pub fn is_desktop(location: &str) -> bool {
    location.eq_ignore_ascii_case(DESKTOP)
}

/// A location that is not a file-system path: `::{GUID}...` or the namespace root.
pub fn is_virtual(location: &str) -> bool {
    location.starts_with("::") || is_desktop(location)
}

/// Key to compare folder paths by: no trailing `\`, lower case (Windows paths ignore case).
pub fn key(path: &str) -> String {
    path.trim_end_matches('\\').to_lowercase()
}

/// `path` is somewhere below one of `folders` (not one of them itself). `folders` holds `key`s;
/// an empty key never matches. Looks up each parent of `path`, so the cost follows the depth of
/// the path and not the number of folders.
pub fn is_below_any(path: &str, folders: &std::collections::HashSet<String>) -> bool {
    let path = key(path);
    let mut parent = path.as_str();
    while let Some(i) = parent.rfind('\\') {
        parent = &parent[..i];
        if !parent.is_empty() && folders.contains(parent) {
            return true;
        }
    }
    false
}

/// A file name as (stem, extension with its dot): `a.tar.gz` is (`a.tar`, `.gz`). A name that
/// only starts with a dot (`.gitignore`) has no extension.
pub fn split_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(dot) if dot > 0 => name.split_at(dot),
        _ => (name, ""),
    }
}

/// The `n`th name for something whose own name is taken: `stem (n).ext`.
pub fn numbered(stem: &str, n: u32, ext: &str) -> String {
    format!("{stem} ({n}){ext}")
}

/// What follows `http://` or `https://` (in any case); `None` for anything else.
pub fn strip_http(s: &str) -> Option<&str> {
    ["https://", "http://"].iter().find_map(|scheme| {
        let head = s.get(..scheme.len())?;
        head.eq_ignore_ascii_case(scheme).then(|| &s[scheme.len()..])
    })
}

/// `http://` / `https://` addresses.
pub fn is_http_url(s: &str) -> bool {
    strip_http(s).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn virtual_locations() {
        assert!(is_desktop("DESKTOP") && is_desktop("Desktop"));
        assert!(!is_desktop("DESKTOP\\x") && !is_desktop("C:\\Desktop"));
        assert!(is_virtual("::{20D04FE0-3AEA-1069-A2D8-08002B30309D}"));
        assert!(is_virtual("desktop"));
        assert!(!is_virtual("C:\\a") && !is_virtual("\\\\srv\\share") && !is_virtual(""));
    }

    #[test]
    fn key_ignores_case_and_the_trailing_separator() {
        assert_eq!(key("C:\\Foo\\"), "c:\\foo");
        assert_eq!(key("C:\\FOO"), key("c:\\foo\\\\"));
        assert_eq!(key("D:\\フォルダ\\Ä"), "d:\\フォルダ\\ä");
        assert_eq!(key("C:\\"), "c:");
    }

    #[test]
    fn is_below_any_matches_items_below_a_folder_only() {
        let set = |folders: &[&str]| folders.iter().map(|f| key(f)).collect::<std::collections::HashSet<_>>();
        assert!(is_below_any(r"C:\a\b\c.txt", &set(&[r"C:\a\b"])));
        assert!(is_below_any(r"C:\A\B\sub\c.txt", &set(&[r"C:\x", r"c:\a\b\"])));
        assert!(!is_below_any(r"C:\a\b", &set(&[r"C:\a\b"])));
        assert!(!is_below_any(r"C:\a\bc\d.txt", &set(&[r"C:\a\b"])));
        assert!(!is_below_any(r"C:\a\b", &set(&[""])));
        assert!(!is_below_any(r"\\srv\share\a", &set(&[""])));
        assert!(!is_below_any(r"C:\あ\い", &set(&[r"C:\あい"])));
        assert!(!is_below_any("", &set(&[r"C:\a"])));
    }

    #[test]
    fn split_ext_takes_the_last_extension() {
        assert_eq!(split_ext("a.png"), ("a", ".png"));
        assert_eq!(split_ext("a.tar.gz"), ("a.tar", ".gz"));
        assert_eq!(split_ext("name"), ("name", ""));
        assert_eq!(split_ext(".gitignore"), (".gitignore", ""));
        assert_eq!(split_ext("写真.JPG"), ("写真", ".JPG"));
        assert_eq!(split_ext("a."), ("a", "."));
        assert_eq!(split_ext(""), ("", ""));
    }

    #[test]
    fn numbered_names() {
        assert_eq!(numbered("a", 2, ".png"), "a (2).png");
        assert_eq!(numbered("b", 3, ""), "b (3)");
    }

    #[test]
    fn urls_are_recognised() {
        assert!(is_http_url("https://github.com/khlizard/vesta"));
        assert!(is_http_url("HTTP://example.com"));
        assert!(!is_http_url("C:\\https\\x"));
        assert!(!is_http_url("ftp://example.com"));
        assert!(!is_http_url("httpsあ://x"));
        assert_eq!(strip_http("HTTPS://Example.com/A"), Some("Example.com/A"));
        assert_eq!(strip_http("http://"), Some(""));
        assert_eq!(strip_http("http:/"), None);
    }
}
