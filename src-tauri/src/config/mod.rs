//! Loading of the user-edited `usr/*.xml` files (menus, bars, key bindings).
//! Spec: docs/spec/config.md. The JSON form mirrors `src/config/types.ts`.

mod xml;

use std::fs;
use std::io::Write;
use std::path::Path;

use serde::Serialize;

#[derive(Debug, Default, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub navigate: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execute: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_files: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub separator: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<MenuItem>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct KeyBinding {
    pub modifier: String,
    pub key: String,
    pub item: MenuItem,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiConfig {
    pub menu: Vec<MenuItem>,
    pub tool: Vec<MenuItem>,
    pub status: Vec<MenuItem>,
    pub link: Vec<MenuItem>,
    pub key_form: Vec<KeyBinding>,
    pub key_folder: Vec<KeyBinding>,
}

const MENU_XML: &str = include_str!("../../resources/usr/menu.xml");
const TOOL_XML: &str = include_str!("../../resources/usr/tool.xml");
const STATUS_XML: &str = include_str!("../../resources/usr/status.xml");
const LINK_XML: &str = include_str!("../../resources/usr/link.xml");
const KEYBOARD_FORM_XML: &str = include_str!("../../resources/usr/keyboard-form.xml");
const KEYBOARD_FOLDER_XML: &str = include_str!("../../resources/usr/keyboard-folder.xml");

/// Reads `usr/<name>`, writing the embedded default first when the file is missing
/// (an existing file is never overwritten). Falls back to the default on any error.
fn load_one<T>(
    usr: &Path,
    name: &str,
    default: &str,
    parse: fn(&str) -> Result<T, String>,
    warnings: &mut Vec<String>,
) -> T {
    let path = usr.join(name);
    match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut f) => {
            if let Err(e) = f.write_all(default.as_bytes()) {
                warnings.push(format!("{name}: cannot write default file: {e}"));
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => warnings.push(format!("{name}: cannot create default file: {e}")),
    }
    let parsed = fs::read(&path)
        .map_err(|e| format!("cannot read: {e}"))
        .and_then(|bytes| parse(&xml::decode(&bytes)));
    match parsed {
        Ok(v) => v,
        Err(e) => {
            warnings.push(format!("{name}: {e}; using the built-in default"));
            parse(default).expect("embedded default must parse")
        }
    }
}

/// The built-in settings, for when `usr/` cannot be used at all (no menus or keys would
/// leave the window unusable).
pub fn defaults() -> UiConfig {
    const MSG: &str = "embedded default must parse";
    UiConfig {
        menu: xml::parse_menu(MENU_XML).expect(MSG),
        tool: xml::parse_menu(TOOL_XML).expect(MSG),
        status: xml::parse_menu(STATUS_XML).expect(MSG),
        link: xml::parse_menu(LINK_XML).expect(MSG),
        key_form: xml::parse_keyboard(KEYBOARD_FORM_XML).expect(MSG),
        key_folder: xml::parse_keyboard(KEYBOARD_FOLDER_XML).expect(MSG),
    }
}

/// Loads all six files from `usr/`.
pub fn load(usr: &Path) -> (UiConfig, Vec<String>) {
    let mut w = Vec::new();
    let config = UiConfig {
        menu: load_one(usr, "menu.xml", MENU_XML, xml::parse_menu, &mut w),
        tool: load_one(usr, "tool.xml", TOOL_XML, xml::parse_menu, &mut w),
        status: load_one(usr, "status.xml", STATUS_XML, xml::parse_menu, &mut w),
        link: load_one(usr, "link.xml", LINK_XML, xml::parse_menu, &mut w),
        key_form: load_one(usr, "keyboard-form.xml", KEYBOARD_FORM_XML, xml::parse_keyboard, &mut w),
        key_folder: load_one(usr, "keyboard-folder.xml", KEYBOARD_FOLDER_XML, xml::parse_keyboard, &mut w),
    };
    (config, w)
}

#[cfg(test)]
mod tests {
    use super::xml::{decode, parse_keyboard, parse_menu};
    use super::*;

    #[test]
    fn default_menu() {
        let m = parse_menu(MENU_XML).unwrap();
        assert_eq!(m.len(), 8);
        assert_eq!(m[0].text.as_deref(), Some("ファイル(_F)"));
        let first = &m[0].children.as_ref().unwrap()[0];
        assert_eq!(first.command.as_deref(), Some("Current.NewFolder"));
        assert_eq!(first.image, Some(27));
    }

    #[test]
    fn default_tool_status() {
        let t = parse_menu(TOOL_XML).unwrap();
        assert_eq!(t.len(), 17);
        assert_eq!(t[0].command.as_deref(), Some("Current.Go.Back"));
        assert_eq!(t[0].image, Some(7));
        assert_eq!(t[0].text.as_deref(), Some("戻る"));
        assert_eq!(t[3].separator, Some(true));
        let s = parse_menu(STATUS_XML).unwrap();
        assert!(s.iter().any(|i| i.separator == Some(true)));
        assert!(s.iter().any(|i| i.command.as_deref() == Some("Current.Mode.Thumbnail")));
        assert_eq!(s[0].text.as_deref(), Some("1"));
        assert_eq!(s[0].command.as_deref(), Some("Tab[1].Show(toggle)"));
    }

    #[test]
    fn empty_text_is_omitted() {
        let s = parse_menu("<menu><menu text=\"\" command=\"A\"/></menu>").unwrap();
        assert_eq!(s[0].text, None);
    }

    #[test]
    fn default_link() {
        let l = parse_menu(LINK_XML).unwrap();
        assert_eq!(l.len(), 5);
        assert_eq!(l[0].path.as_deref(), Some("DRIVES"));
        assert_eq!(l[0].depth, Some(1));
        assert_eq!(l[2].path.as_deref(), Some("MYDOCUMENTS"));
        assert_eq!(l[2].include_files, None);
        assert_eq!(l[3].path.as_deref(), Some("%USERPROFILE%\\Downloads"));
        let kids = l[4].children.as_ref().unwrap();
        assert_eq!(kids[0].path.as_deref(), Some("MYPICTURES"));
        assert!(kids.iter().any(|k| k.separator == Some(true)));
        assert_eq!(l[4].path, None);
    }

    #[test]
    fn default_keyboards() {
        let f = parse_keyboard(KEYBOARD_FOLDER_XML).unwrap();
        let b = f.iter().find(|b| b.modifier == "CS" && b.key == "C").unwrap();
        let kids = b.item.children.as_ref().unwrap();
        assert!(!kids.is_empty());
        assert!(kids[0].command.is_some());
        assert_eq!(b.item.separator, None);
        let esc = f.iter().find(|b| b.key == "escape").unwrap();
        assert_eq!(esc.modifier, "");
        assert_eq!(esc.item.command.as_deref(), Some("Current.SelectNone"));
        assert!(!parse_keyboard(KEYBOARD_FORM_XML).unwrap().is_empty());
    }

    #[test]
    fn defaults_load_without_warnings() {
        let dir = tempfile::tempdir().unwrap();
        let (cfg, w) = load(dir.path());
        assert!(w.is_empty(), "{w:?}");
        assert_eq!(cfg.menu.len(), 8);
        for n in ["menu", "tool", "status", "link", "keyboard-form", "keyboard-folder"] {
            assert!(dir.path().join(format!("{n}.xml")).is_file(), "{n}");
        }
    }

    #[test]
    fn decode_encodings() {
        let src = "<menu><menu text=\"ファイル(_F)\"/></menu>";
        let (sjis, _, _) = encoding_rs::SHIFT_JIS.encode(src);
        assert!(std::str::from_utf8(&sjis).is_err());
        assert_eq!(decode(&sjis), src);
        let mut bom = vec![0xEF, 0xBB, 0xBF];
        bom.extend_from_slice(src.as_bytes());
        assert_eq!(decode(&bom), src);
        assert_eq!(decode(src.as_bytes()), src);
        let mut le = vec![0xFF, 0xFE];
        le.extend(src.encode_utf16().flat_map(|u| u.to_le_bytes()));
        assert_eq!(decode(&le), src);
        let mut be = vec![0xFE, 0xFF];
        be.extend(src.encode_utf16().flat_map(|u| u.to_be_bytes()));
        assert_eq!(decode(&be), src);
    }

    #[test]
    fn sjis_file_with_wrong_declaration() {
        let src = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<menu><menu text=\"開く(_O)\" command=\"File.Open\"/></menu>";
        let (sjis, _, _) = encoding_rs::SHIFT_JIS.encode(src);
        let items = parse_menu(&decode(&sjis)).unwrap();
        assert_eq!(items[0].text.as_deref(), Some("開く(_O)"));
    }

    #[test]
    fn built_in_defaults_parse() {
        let d = defaults();
        assert_eq!(d.menu.len(), 8);
        assert!(!d.key_form.is_empty() && !d.key_folder.is_empty());
    }

    #[test]
    fn single_quoted_args_keep_double_quotes() {
        let items =
            parse_menu("<menu><menu text=\"a\" path=\"p.exe\" args='--dir=\"C:\\x y\" &quot;z&quot;'/></menu>").unwrap();
        assert_eq!(items[0].args.as_deref(), Some("--dir=\"C:\\x y\" \"z\""));
    }
    #[test]
    fn separators_and_attributes() {
        let items = parse_menu(
            "<!-- c --><menu><menu/><menu text=\"a\" include-files=\"no\" depth=\"2\" x=\"1\"><menu/><foo/></menu>\
             <menu path=\"p\" include-files=\"3\" navigate=\"n\" execute=\"e\" args=\"a &amp; b\"/></menu>",
        )
        .unwrap();
        assert_eq!(items[0], MenuItem { separator: Some(true), ..Default::default() });
        assert_eq!(items[1].include_files, Some(false));
        assert_eq!(items[1].depth, Some(2));
        assert_eq!(items[1].children.as_ref().unwrap().len(), 1);
        assert_eq!(items[2].include_files, Some(true));
        assert_eq!(items[2].args.as_deref(), Some("a & b"));
        let json = serde_json::to_value(&items[0]).unwrap();
        assert_eq!(json, serde_json::json!({ "separator": true }));
        let json = serde_json::to_value(&items[2]).unwrap();
        assert_eq!(json["includeFiles"], true);
    }

    #[test]
    fn keyboard_json_shape() {
        let k = parse_keyboard(
            "<keyboard><bind modifier=\"C\" key=\"E\" execute=\"x.exe\" args=\"[selected]\"/><bind key=\"F2\" command=\"A\"/><bind modifier=\"C\"/></keyboard>",
        )
        .unwrap();
        assert_eq!(k.len(), 2);
        assert_eq!(
            serde_json::to_value(&k[0]).unwrap(),
            serde_json::json!({"modifier":"C","key":"E","item":{"execute":"x.exe","args":"[selected]"}})
        );
        assert_eq!(k[1].modifier, "");
    }

    #[test]
    fn malformed_and_wrong_root() {
        assert!(parse_menu("<menu><menu></menu>").is_err());
        assert!(parse_menu("<menu></foo>").is_err());
        assert!(parse_menu("").is_err());
        assert!(parse_menu("<keyboard/>").is_err());
        assert!(parse_keyboard("<menu/>").is_err());
    }

    #[test]
    fn malformed_file_falls_back_with_warning_and_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("tool.xml"), "<menu><menu>").unwrap();
        let (cfg, w) = load(dir.path());
        assert_eq!(w.len(), 1, "{w:?}");
        assert!(w[0].contains("tool.xml"));
        assert_eq!(cfg.tool.len(), 17);
        assert_eq!(fs::read_to_string(dir.path().join("tool.xml")).unwrap(), "<menu><menu>");
    }

    #[test]
    fn existing_file_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let custom = "<menu><menu text=\"x\" command=\"Y\"/></menu>";
        fs::write(dir.path().join("menu.xml"), custom).unwrap();
        let (cfg, w) = load(dir.path());
        assert!(w.is_empty(), "{w:?}");
        assert_eq!(cfg.menu.len(), 1);
        assert_eq!(fs::read_to_string(dir.path().join("menu.xml")).unwrap(), custom);
    }

    /// Reads a real usr/ folder (e.g. one copied from Avesta): set VESTA_TEST_USR and run with --ignored.
    #[test]
    #[ignore]
    fn real_user_files() {
        let Ok(dir) = std::env::var("VESTA_TEST_USR") else { return };
        let (cfg, w) = load(Path::new(&dir));
        assert!(w.is_empty(), "{w:?}");
        assert!(!cfg.menu.is_empty() && !cfg.tool.is_empty() && !cfg.link.is_empty());
        assert!(!cfg.key_folder.is_empty() && !cfg.key_form.is_empty());
        println!(
            "menu={} tool={} status={} link={} form={} folder={}",
            cfg.menu.len(),
            cfg.tool.len(),
            cfg.status.len(),
            cfg.link.len(),
            cfg.key_form.len(),
            cfg.key_folder.len()
        );
    }
}
