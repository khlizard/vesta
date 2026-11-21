//! Tolerant reader for Avesta's `usr/*.xml` files: encoding detection and parsing.
//! Spec: docs/spec/config.md「XML の共通ルール」

use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};

use super::{KeyBinding, MenuItem};

/// Decodes file bytes. The XML declaration is not trusted: BOM first, then valid UTF-8,
/// then Shift_JIS.
pub fn decode(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return encoding_rs::UTF_16LE.decode_without_bom_handling(rest).0.into_owned();
    }
    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return encoding_rs::UTF_16BE.decode_without_bom_handling(rest).0.into_owned();
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => encoding_rs::SHIFT_JIS.decode_without_bom_handling(bytes).0.into_owned(),
    }
}

struct Node {
    name: String,
    attrs: Vec<(String, String)>,
    children: Vec<Node>,
}

impl Node {
    fn attr(&self, key: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }
}

fn start_node(e: &BytesStart<'_>) -> Result<Node, String> {
    let name = e.name().as_ref().to_string();
    let mut attrs = Vec::new();
    for a in e.attributes().with_checks(false) {
        let a = a.map_err(|e| e.to_string())?;
        let key = a.key.as_ref().to_string();
        let value = a.normalized_value(quick_xml::XmlVersion::Implicit1_0).map_err(|e| e.to_string())?.into_owned();
        attrs.push((key, value));
    }
    Ok(Node { name, attrs, children: Vec::new() })
}

/// Builds an element tree; comments, PIs, doctype and text are ignored.
fn parse_tree(text: &str) -> Result<Node, String> {
    let mut reader = Reader::from_str(text);
    let mut stack: Vec<Node> = Vec::new();
    let mut root: Option<Node> = None;
    loop {
        let pos = reader.buffer_position();
        let ev = reader.read_event().map_err(|e| format!("XML error at byte {pos}: {e}"))?;
        match ev {
            Event::Start(e) => stack.push(start_node(&e)?),
            Event::Empty(e) => {
                let node = start_node(&e)?;
                match stack.last_mut() {
                    Some(parent) => parent.children.push(node),
                    None if root.is_none() => root = Some(node),
                    None => return Err("ルート要素が 2 つ以上あります".into()),
                }
            }
            Event::End(_) => {
                let node = stack.pop().ok_or("unexpected end tag")?;
                match stack.last_mut() {
                    Some(parent) => parent.children.push(node),
                    None if root.is_none() => root = Some(node),
                    None => return Err("ルート要素が 2 つ以上あります".into()),
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !stack.is_empty() {
        return Err("要素が閉じられないまま終わっています".into());
    }
    root.ok_or_else(|| "no root element".into())
}

fn parse_bool(s: &str) -> Option<bool> {
    let s = s.trim().to_ascii_lowercase();
    match s.as_str() {
        "true" | "yes" => Some(true),
        "false" | "no" => Some(false),
        _ => s.parse::<i64>().ok().map(|n| n != 0),
    }
}

fn item_of(n: &Node, allow_separator: bool) -> MenuItem {
    let s = |k: &str| n.attr(k).map(str::to_string);
    let children: Vec<MenuItem> = n
        .children
        .iter()
        .filter(|c| c.name == "menu")
        .map(|c| item_of(c, true))
        .collect();
    let separator = allow_separator && n.attrs.is_empty() && children.is_empty();
    MenuItem {
        text: s("text").filter(|t| !t.is_empty()),
        command: s("command"),
        navigate: s("navigate"),
        execute: s("execute"),
        args: s("args"),
        image: n.attr("image").and_then(|v| v.trim().parse().ok()),
        path: s("path"),
        depth: n.attr("depth").and_then(|v| v.trim().parse().ok()),
        include_files: n.attr("include-files").and_then(parse_bool),
        separator: separator.then_some(true),
        children: (!children.is_empty()).then_some(children),
    }
}

/// Parses a `<menu>` file (menu / tool / status / link).
pub fn parse_menu(text: &str) -> Result<Vec<MenuItem>, String> {
    let root = parse_tree(text)?;
    if root.name != "menu" {
        return Err(format!("root element is <{}>, expected <menu>", root.name));
    }
    Ok(root.children.iter().filter(|c| c.name == "menu").map(|c| item_of(c, true)).collect())
}

/// Parses a `<keyboard>` file (keyboard-form / keyboard-folder).
pub fn parse_keyboard(text: &str) -> Result<Vec<KeyBinding>, String> {
    let root = parse_tree(text)?;
    if root.name != "keyboard" {
        return Err(format!("root element is <{}>, expected <keyboard>", root.name));
    }
    Ok(root
        .children
        .iter()
        .filter(|c| c.name == "bind")
        .filter_map(|b| {
            let key = b.attr("key")?.to_string();
            let modifier = b.attr("modifier").unwrap_or("").to_string();
            Some(KeyBinding { modifier, key, item: item_of(b, false) })
        })
        .collect())
}
