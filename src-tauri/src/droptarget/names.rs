//! Names and formats of dropped data that has no path: reading the file list a drag carries,
//! and making names that are safe to create. No COM and no disk access here.

use crate::path;

/// One file of a FILEGROUPDESCRIPTORW block.
#[derive(Debug, PartialEq)]
pub(super) struct VirtualFile {
    pub(super) name: String,
    pub(super) directory: bool,
    pub(super) size: Option<u64>,
}

/// The text of a UTF-16 (little endian) buffer, up to the first NUL.
pub(super) fn wide_text(bytes: &[u8]) -> String {
    let wide: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| u16::from_le_bytes(*c))
        .take_while(|&c| c != 0)
        .collect();
    String::from_utf16_lossy(&wide)
}

/// Reads a FILEGROUPDESCRIPTORW block: a count, then FILEDESCRIPTORW records of 592 bytes.
pub(super) fn descriptor_files(bytes: &[u8]) -> Vec<VirtualFile> {
    const RECORD: usize = 592;
    const ATTRIBUTES: usize = 36;
    const SIZE_HIGH: usize = 64;
    const SIZE_LOW: usize = 68;
    const NAME: usize = 72;
    const FD_ATTRIBUTES: u32 = 0x4;
    const FD_FILESIZE: u32 = 0x40;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;

    let u32_at = |at: usize| {
        bytes
            .get(at..at + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    };
    let Some(count) = u32_at(0) else { return Vec::new() };
    let count = (count as usize).min(bytes.len().saturating_sub(4) / RECORD);
    (0..count)
        .map(|i| {
            let base = 4 + i * RECORD;
            let flags = u32_at(base).unwrap_or(0);
            let attributes = u32_at(base + ATTRIBUTES).unwrap_or(0);
            let size = (flags & FD_FILESIZE != 0).then(|| {
                let high = u32_at(base + SIZE_HIGH).unwrap_or(0) as u64;
                let low = u32_at(base + SIZE_LOW).unwrap_or(0) as u64;
                (high << 32) | low
            });
            VirtualFile {
                name: wide_text(&bytes[base + NAME..base + RECORD]),
                directory: flags & FD_ATTRIBUTES != 0 && attributes & FILE_ATTRIBUTE_DIRECTORY != 0,
                size,
            }
        })
        .collect()
}

/// A file name that is safe to create: the last path component of `raw`, without characters
/// Windows refuses. The name comes from another program (a web page), so it is not trusted.
pub(super) fn safe_name(raw: &str) -> String {
    const MAX_UNITS: usize = 200;
    const MAX_EXT_UNITS: usize = 40;
    let last = raw.rsplit(['\\', '/']).next().unwrap_or("");
    let cleaned: String = last
        .chars()
        .map(|c| if c < ' ' || "<>:\"|?*".contains(c) { '_' } else { c })
        .collect();
    let mut name = cleaned.trim_start().trim_end_matches([' ', '.']).to_string();
    if name.is_empty() || name.chars().all(|c| c == '.') {
        name = "download".to_string();
    }
    let (stem, ext) = path::split_ext(&name);
    // CON, NUL, COM1 ... are devices whatever the extension.
    let device = stem.split('.').next().unwrap_or("").trim().to_ascii_uppercase();
    let reserved = matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (device.len() == 4
            && (device.starts_with("COM") || device.starts_with("LPT"))
            && device.ends_with(|c: char| c.is_ascii_digit() && c != '0'));
    let stem = if reserved { format!("_{stem}") } else { stem.to_string() };
    // Windows counts a name in UTF-16 units (an emoji is two), at most 255.
    let ext = take_units(ext, MAX_EXT_UNITS);
    let stem = take_units(&stem, (MAX_UNITS - ext.encode_utf16().count()).max(1));
    // Cutting may leave a space or a period at the end, which Windows would drop by itself.
    let name = format!("{stem}{ext}");
    let name = name.trim_end_matches([' ', '.']);
    if name.is_empty() {
        "download".to_string()
    } else {
        name.to_string()
    }
}

/// The start of `s` that fits in `max` UTF-16 units, without splitting a character.
fn take_units(s: &str, max: usize) -> String {
    let mut units = 0;
    s.chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= max
        })
        .collect()
}

/// Makes the names of one drop differ from each other: "a.png", "a (2).png", ...
pub(super) fn distinct_names(names: Vec<String>) -> Vec<String> {
    let mut taken = std::collections::HashSet::new();
    names
        .into_iter()
        .map(|name| {
            let (stem, ext) = path::split_ext(&name);
            let mut candidate = name.clone();
            let mut n = 2;
            while !taken.insert(candidate.to_lowercase()) {
                candidate = path::numbered(stem, n, ext);
                n += 1;
            }
            candidate
        })
        .collect()
}

/// The name and contents of an Internet shortcut for `url`; `None` unless it is http(s).
pub(super) fn url_shortcut(url: &str) -> Option<(String, String)> {
    let url = url.lines().next().unwrap_or("").trim();
    let rest = path::strip_http(url)?.to_ascii_lowercase();
    let host = rest.split(['/', '?', '#', ':', '@']).next().unwrap_or("");
    if host.is_empty() {
        return None;
    }
    Some((
        safe_name(&format!("{host}.url")),
        format!("[InternetShortcut]\r\nURL={url}\r\n"),
    ))
}

/// A FILEGROUPDESCRIPTORW block for tests: (name, flags, attributes, size) of each file.
#[cfg(test)]
pub(super) fn descriptor(files: &[(&str, u32, u32, u64)]) -> Vec<u8> {
    let mut bytes = (files.len() as u32).to_le_bytes().to_vec();
    for (name, flags, attributes, size) in files {
        let mut record = vec![0u8; 592];
        record[0..4].copy_from_slice(&flags.to_le_bytes());
        record[36..40].copy_from_slice(&attributes.to_le_bytes());
        record[64..68].copy_from_slice(&((size >> 32) as u32).to_le_bytes());
        record[68..72].copy_from_slice(&(*size as u32).to_le_bytes());
        for (i, c) in name.encode_utf16().enumerate() {
            record[72 + i * 2..74 + i * 2].copy_from_slice(&c.to_le_bytes());
        }
        bytes.extend(record);
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn descriptor_files_reads_names_sizes_and_folders() {
        let bytes = descriptor(&[("画像.png", 0x40, 0, 5), ("sub", 0x4, 0x10, 0), ("b.txt", 0, 0, 0)]);
        assert_eq!(
            descriptor_files(&bytes),
            vec![
                VirtualFile {
                    name: "画像.png".into(),
                    directory: false,
                    size: Some(5)
                },
                VirtualFile {
                    name: "sub".into(),
                    directory: true,
                    size: None
                },
                VirtualFile {
                    name: "b.txt".into(),
                    directory: false,
                    size: None
                },
            ]
        );
    }

    #[test]
    fn descriptor_files_ignores_a_count_beyond_the_data() {
        let mut bytes = descriptor(&[("a.txt", 0, 0, 0)]);
        bytes[0..4].copy_from_slice(&1000u32.to_le_bytes());
        assert_eq!(descriptor_files(&bytes).len(), 1);
        assert!(descriptor_files(&[]).is_empty());
        assert!(descriptor_files(&[1, 0, 0, 0, 9]).is_empty());
    }

    #[test]
    fn safe_name_keeps_only_a_file_name() {
        assert_eq!(safe_name("photo.png"), "photo.png");
        assert_eq!(safe_name(r"..\..\Windows\evil.exe"), "evil.exe");
        assert_eq!(safe_name("a/b/c.txt"), "c.txt");
        assert_eq!(safe_name(r"C:\x\y.txt"), "y.txt");
        assert_eq!(safe_name("what? <1>: \"x\"|*.txt"), "what_ _1__ _x___.txt");
        assert_eq!(safe_name("tab\tname.txt"), "tab_name.txt");
        assert_eq!(safe_name("  name. . "), "name");
    }

    #[test]
    fn safe_name_replaces_empty_and_reserved_names() {
        assert_eq!(safe_name(""), "download");
        assert_eq!(safe_name(".."), "download");
        assert_eq!(safe_name(r"dir\"), "download");
        assert_eq!(safe_name("CON"), "_CON");
        assert_eq!(safe_name("nul.txt"), "_nul.txt");
        assert_eq!(safe_name("com1.tar.gz"), "_com1.tar.gz");
        assert_eq!(safe_name("COM0.txt"), "COM0.txt");
        assert_eq!(safe_name("console.txt"), "console.txt");
    }

    #[test]
    fn safe_name_limits_the_length_and_keeps_the_extension() {
        let name = safe_name(&format!("{}.jpeg", "あ".repeat(300)));
        assert_eq!(name.chars().count(), 200);
        assert!(name.ends_with(".jpeg"));
    }

    #[test]
    fn safe_name_counts_the_length_the_way_windows_does() {
        // An emoji is one character but two UTF-16 units; 300 of them would be 600.
        let name = safe_name(&format!("{}.png", "😀".repeat(300)));
        assert!(name.encode_utf16().count() <= 200, "{}", name.encode_utf16().count());
        assert!(name.ends_with(".png"));
        assert!(name.starts_with("😀"));
        // A very long "extension" is cut too, and no half character is left.
        let name = safe_name(&format!("a.{}", "é😀".repeat(200)));
        assert!(name.encode_utf16().count() <= 200);
        assert!(String::from_utf16(&name.encode_utf16().collect::<Vec<_>>()).is_ok());
        // Cutting must not leave a name that ends in a space or a period.
        let name = safe_name(&format!("{} tail", "a".repeat(199)));
        assert_eq!(name, "a".repeat(199));
        // Names in other scripts stay as they are.
        assert_eq!(safe_name("写真 2026年 🎉.jpg"), "写真 2026年 🎉.jpg");
        assert_eq!(safe_name("か\u{3099}.txt"), "か\u{3099}.txt");
    }

    #[test]
    fn distinct_names_numbers_repeats() {
        let names = vec![
            "a.png".to_string(),
            "A.PNG".to_string(),
            "a.png".to_string(),
            "b".to_string(),
            "b".to_string(),
        ];
        assert_eq!(
            distinct_names(names),
            vec!["a.png", "A (2).PNG", "a (3).png", "b", "b (2)"]
        );
    }

    #[test]
    fn url_shortcut_takes_web_addresses_only() {
        let (name, text) = url_shortcut("https://example.com/a/b?c=1").unwrap();
        assert_eq!(name, "example.com.url");
        assert_eq!(text, "[InternetShortcut]\r\nURL=https://example.com/a/b?c=1\r\n");
        assert_eq!(url_shortcut("HTTP://Example.com:8080/").unwrap().0, "example.com.url");
        // Only the first line: nothing else may be written into the shortcut file.
        assert_eq!(
            url_shortcut("https://a.example/x\r\nIconFile=evil").unwrap().1,
            "[InternetShortcut]\r\nURL=https://a.example/x\r\n"
        );
        assert!(url_shortcut("file:///C:/Windows/notepad.exe").is_none());
        assert!(url_shortcut("javascript:alert(1)").is_none());
        assert!(url_shortcut("https://").is_none());
        assert!(url_shortcut("").is_none());
    }
}
