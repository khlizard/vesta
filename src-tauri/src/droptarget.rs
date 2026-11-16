//! The window's drop target. Spec: docs/spec/fileops.md
//!
//! Takes files (CF_HDROP), virtual files that carry their contents (FileGroupDescriptorW +
//! FileContents: images and links from browsers, mail attachments) and bare URLs. It replaces the
//! handler Tauri registers, which takes CF_HDROP only and refuses everything else.
//!
//! The frontend gets `drag-drop` events (enter / over / drop / leave) with the position and
//! decides where the drop goes. Data without paths is written to a temporary folder inside `Drop`
//! (the data object is only valid there) and the frontend moves the files to their destination.

use std::cell::{Cell, RefCell};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Foundation::{DRAGDROP_E_INVALIDHWND, HWND, LPARAM, POINT, POINTL};
use windows::Win32::Graphics::Gdi::{ClientToScreen, ScreenToClient};
use windows::Win32::System::Com::{
    DVASPECT_CONTENT, FORMATETC, IDataObject, STGMEDIUM, STREAM_SEEK_SET, TYMED_HGLOBAL, TYMED_ISTREAM,
};
use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
use windows::Win32::System::Ole::{
    CF_HDROP, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_MOVE, DROPEFFECT_NONE, IDropTarget,
    IDropTarget_Impl,
    RegisterDragDrop, ReleaseStgMedium, RevokeDragDrop,
};
use windows::Win32::System::SystemServices::{MK_RBUTTON, MODIFIERKEYS_FLAGS};
use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};
use windows::Win32::UI::WindowsAndMessaging::{EnumChildWindows, SetForegroundWindow};
use windows::core::{BOOL, PCWSTR, Ref, implement, w};

use crate::com;

const EVENT: &str = "drag-drop";
const TEMP_FOLDER: &str = "vesta-drop";

// ---------------------------------------------------------------- names and formats (pure)

/// One file of a FILEGROUPDESCRIPTORW block.
#[derive(Debug, PartialEq)]
struct VirtualFile {
    name: String,
    directory: bool,
    size: Option<u64>,
}

/// The text of a UTF-16 (little endian) buffer, up to the first NUL.
fn wide_text(bytes: &[u8]) -> String {
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
fn descriptor_files(bytes: &[u8]) -> Vec<VirtualFile> {
    const RECORD: usize = 592;
    const ATTRIBUTES: usize = 36;
    const SIZE_HIGH: usize = 64;
    const SIZE_LOW: usize = 68;
    const NAME: usize = 72;
    const FD_ATTRIBUTES: u32 = 0x4;
    const FD_FILESIZE: u32 = 0x40;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;

    let u32_at = |at: usize| bytes.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]));
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
fn safe_name(raw: &str) -> String {
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
    let (stem, ext) = match name.rfind('.') {
        Some(dot) if dot > 0 => (name[..dot].to_string(), name[dot..].to_string()),
        _ => (name.clone(), String::new()),
    };
    // CON, NUL, COM1 ... are devices whatever the extension.
    let device = stem.split('.').next().unwrap_or("").trim().to_ascii_uppercase();
    let reserved = matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (device.len() == 4
            && (device.starts_with("COM") || device.starts_with("LPT"))
            && device.ends_with(|c: char| c.is_ascii_digit() && c != '0'));
    let stem = if reserved { format!("_{stem}") } else { stem };
    // Windows counts a name in UTF-16 units (an emoji is two), at most 255.
    let ext = take_units(&ext, MAX_EXT_UNITS);
    let stem = take_units(&stem, (MAX_UNITS - ext.encode_utf16().count()).max(1));
    // Cutting may leave a space or a period at the end, which Windows would drop by itself.
    let name = format!("{stem}{ext}");
    let name = name.trim_end_matches([' ', '.']);
    if name.is_empty() { "download".to_string() } else { name.to_string() }
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
fn distinct_names(names: Vec<String>) -> Vec<String> {
    let mut taken = std::collections::HashSet::new();
    names
        .into_iter()
        .map(|name| {
            let (stem, ext) = match name.rfind('.') {
                Some(dot) if dot > 0 => (&name[..dot], &name[dot..]),
                _ => (name.as_str(), ""),
            };
            let mut candidate = name.clone();
            let mut n = 2;
            while !taken.insert(candidate.to_lowercase()) {
                candidate = format!("{stem} ({n}){ext}");
                n += 1;
            }
            candidate
        })
        .collect()
}

/// The name and contents of an Internet shortcut for `url`; `None` unless it is http(s).
fn url_shortcut(url: &str) -> Option<(String, String)> {
    let url = url.lines().next().unwrap_or("").trim();
    let lower = url.to_ascii_lowercase();
    let rest = lower.strip_prefix("https://").or_else(|| lower.strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#', ':', '@']).next().unwrap_or("");
    if host.is_empty() {
        return None;
    }
    Some((safe_name(&format!("{host}.url")), format!("[InternetShortcut]\r\nURL={url}\r\n")))
}

// ---------------------------------------------------------------- data object (COM)

fn format_id(name: PCWSTR) -> u16 {
    unsafe { RegisterClipboardFormatW(name) as u16 }
}

fn descriptor_format() -> u16 {
    format_id(w!("FileGroupDescriptorW"))
}

fn contents_format() -> u16 {
    format_id(w!("FileContents"))
}

fn url_format() -> u16 {
    format_id(w!("UniformResourceLocatorW"))
}

fn formatetc(format: u16, index: i32, tymed: u32) -> FORMATETC {
    FORMATETC {
        cfFormat: format,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: index,
        tymed,
    }
}

fn global(format: u16) -> FORMATETC {
    formatetc(format, -1, TYMED_HGLOBAL.0 as u32)
}

/// The bytes of a format handed over as a memory block.
fn global_data(data: &IDataObject, format: u16) -> Result<Vec<u8>, String> {
    unsafe {
        let mut medium = data.GetData(&global(format)).map_err(com::err)?;
        let bytes = global_bytes(&medium, None);
        ReleaseStgMedium(&mut medium);
        bytes
    }
}

/// The virtual files of `data` with their index in the descriptor. Folders are left out, so files
/// inside them land flat: browsers and mail clients send flat lists.
fn virtual_files(data: &IDataObject) -> Vec<(usize, VirtualFile)> {
    let bytes = global_data(data, descriptor_format()).unwrap_or_default();
    descriptor_files(&bytes).into_iter().enumerate().filter(|(_, f)| !f.directory).collect()
}

/// The Internet shortcut (name, contents) for the URL of `data`.
fn url_of(data: &IDataObject) -> Option<(String, String)> {
    url_shortcut(&wide_text(&global_data(data, url_format()).ok()?))
}

/// What a drag carries, in the order the spec lists.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    None,
    Files,
    Virtual,
    Url,
}

/// Looks at the data itself: some data objects say yes to any format when only asked.
fn kind_of(data: &IDataObject) -> Kind {
    if !hdrop_paths(data).is_empty() {
        Kind::Files
    } else if !virtual_files(data).is_empty() {
        Kind::Virtual
    } else if url_of(data).is_some() {
        Kind::Url
    } else {
        Kind::None
    }
}

/// The bytes of an HGLOBAL medium (at most `limit` of them). Does not release the medium.
unsafe fn global_bytes(medium: &STGMEDIUM, limit: Option<u64>) -> Result<Vec<u8>, String> {
    unsafe {
        let handle = medium.u.hGlobal;
        let size = GlobalSize(handle);
        let p = GlobalLock(handle) as *const u8;
        if p.is_null() {
            return Err("GlobalLock failed".into());
        }
        let len = limit.map_or(size, |l| size.min(l as usize));
        let bytes = std::slice::from_raw_parts(p, len).to_vec();
        let _ = GlobalUnlock(handle);
        Ok(bytes)
    }
}

/// Writes a medium (a stream or a memory block) to `out`, and releases it.
unsafe fn write_medium(mut medium: STGMEDIUM, size: Option<u64>, out: &mut impl Write) -> Result<(), String> {
    unsafe {
        let result = (|| {
            if medium.tymed == TYMED_ISTREAM.0 as u32 {
                let stream = (*medium.u.pstm).as_ref().ok_or("no stream")?;
                // Some sources hand the stream over positioned at its end.
                let _ = stream.Seek(0, STREAM_SEEK_SET, None);
                let mut buf = vec![0u8; 64 * 1024];
                loop {
                    let mut read = 0u32;
                    let hr = stream.Read(buf.as_mut_ptr() as *mut _, buf.len() as u32, Some(&mut read));
                    if hr.is_err() {
                        return Err(com::err(hr.into()));
                    }
                    if read == 0 {
                        return Ok(());
                    }
                    out.write_all(&buf[..read as usize]).map_err(|e| e.to_string())?;
                }
            } else if medium.tymed == TYMED_HGLOBAL.0 as u32 {
                out.write_all(&global_bytes(&medium, size)?).map_err(|e| e.to_string())
            } else {
                Err("unsupported data".to_string())
            }
        })();
        ReleaseStgMedium(&mut medium);
        result
    }
}

fn hdrop_paths(data: &IDataObject) -> Vec<String> {
    unsafe {
        let Ok(mut medium) = data.GetData(&global(CF_HDROP.0)) else { return Vec::new() };
        let hdrop = HDROP(medium.u.hGlobal.0);
        let count = DragQueryFileW(hdrop, u32::MAX, None);
        let paths = (0..count)
            .map(|i| {
                let len = DragQueryFileW(hdrop, i, None) as usize;
                let mut buf = vec![0u16; len + 1];
                DragQueryFileW(hdrop, i, Some(&mut buf));
                String::from_utf16_lossy(&buf[..len])
            })
            .collect();
        ReleaseStgMedium(&mut medium);
        paths
    }
}

/// Writes the virtual files of `data` into `dir`. Returns the files written.
fn save_virtual(data: &IDataObject, dir: &Path) -> Result<Vec<PathBuf>, String> {
    let files = virtual_files(data);
    if files.is_empty() {
        return Err("no files in the dropped data".into());
    }
    let names = distinct_names(files.iter().map(|(_, f)| safe_name(&f.name)).collect());
    let tymed = (TYMED_ISTREAM.0 | TYMED_HGLOBAL.0) as u32;
    let mut written = Vec::new();
    for ((index, file), name) in files.iter().zip(names) {
        let medium = unsafe { data.GetData(&formatetc(contents_format(), *index as i32, tymed)) }
            .map_err(|e| format!("{name}: {}", com::err(e)))?;
        let path = dir.join(&name);
        let mut out = std::fs::File::create(&path).map_err(|e| format!("{name}: {e}"))?;
        unsafe { write_medium(medium, file.size, &mut out) }.map_err(|e| format!("{name}: {e}"))?;
        written.push(path);
    }
    Ok(written)
}

/// Writes an Internet shortcut for the URL of `data` into `dir`.
fn save_url(data: &IDataObject, dir: &Path) -> Result<Vec<PathBuf>, String> {
    let (name, text) = url_of(data).ok_or("not a web address")?;
    let path = dir.join(name);
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(vec![path])
}

fn temp_root() -> PathBuf {
    std::env::temp_dir().join(TEMP_FOLDER)
}

/// A new, empty folder for the files of one drop.
fn new_drop_dir() -> Result<PathBuf, String> {
    static SEQ: AtomicU32 = AtomicU32::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let dir = temp_root().join(format!("{}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Saves what a drag without paths carries. Returns the files, in a temporary folder.
fn save(data: &IDataObject, kind: Kind) -> Result<Vec<String>, String> {
    let dir = new_drop_dir()?;
    let files = match kind {
        Kind::Virtual => save_virtual(data, &dir),
        Kind::Url => save_url(data, &dir),
        Kind::Files | Kind::None => Ok(Vec::new()),
    };
    match files {
        Ok(files) => Ok(files.iter().map(|p| p.to_string_lossy().into_owned()).collect()),
        Err(e) => {
            let _ = std::fs::remove_dir_all(&dir);
            Err(e)
        }
    }
}

// ---------------------------------------------------------------- drop target

#[derive(Serialize, Clone)]
struct Position {
    x: f64,
    y: f64,
}

/// Payload of the `drag-drop` event. `saving`: the drag has no paths; its data is saved on drop,
/// and the dropped `paths` are then temporary files to move to the destination.
#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
enum DragEvent {
    Enter { paths: Vec<String>, position: Position, saving: bool },
    Over { position: Position },
    Drop {
        paths: Vec<String>,
        position: Position,
        saving: bool,
        /// Dragged with the right button: the frontend asks what to do.
        #[serde(rename = "rightButton")]
        right_button: bool,
        error: Option<String>,
    },
    Leave,
}

#[implement(IDropTarget)]
struct Target {
    hwnd: HWND,
    app: AppHandle,
    kind: Cell<Kind>,
    effect: Cell<DROPEFFECT>,
    /// The drag is held with the right button (known while dragging; released by the time of Drop).
    right: Cell<bool>,
}

impl Target {
    /// Position in physical pixels inside the webview (the frontend divides by the scale factor).
    fn position(&self, pt: &POINTL) -> Position {
        let mut p = POINT { x: pt.x, y: pt.y };
        let _ = unsafe { ScreenToClient(self.hwnd, &mut p) };
        Position { x: p.x as f64, y: p.y as f64 }
    }

    fn emit(&self, event: DragEvent) {
        let _ = self.app.emit(EVENT, event);
    }
}

#[allow(non_snake_case)]
impl IDropTarget_Impl for Target_Impl {
    fn DragEnter(
        &self,
        data: Ref<'_, IDataObject>,
        keys: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        self.right.set(keys.0 & MK_RBUTTON.0 != 0);
        let allowed = if effect.is_null() { DROPEFFECT_NONE } else { unsafe { *effect } };
        let mut kind = data.as_ref().map_or(Kind::None, kind_of);
        let chosen = match kind {
            Kind::None => DROPEFFECT_NONE,
            // Whether files are copied or moved is decided by the frontend when they are dropped.
            Kind::Files => DROPEFFECT_COPY,
            // Never MOVE: the source would delete what it handed over.
            Kind::Virtual | Kind::Url if allowed.0 & DROPEFFECT_COPY.0 != 0 => DROPEFFECT_COPY,
            Kind::Virtual | Kind::Url if allowed.0 & DROPEFFECT_LINK.0 != 0 => DROPEFFECT_LINK,
            Kind::Virtual | Kind::Url => DROPEFFECT_NONE,
        };
        if chosen == DROPEFFECT_NONE {
            kind = Kind::None;
        }
        self.kind.set(kind);
        self.effect.set(chosen);
        if !effect.is_null() {
            unsafe { *effect = chosen };
        }
        if kind != Kind::None {
            let paths = match (kind, data.as_ref()) {
                (Kind::Files, Some(data)) => hdrop_paths(data),
                _ => Vec::new(),
            };
            self.emit(DragEvent::Enter { paths, position: self.position(pt), saving: kind != Kind::Files });
        }
        Ok(())
    }

    fn DragOver(&self, keys: MODIFIERKEYS_FLAGS, pt: &POINTL, effect: *mut DROPEFFECT) -> windows::core::Result<()> {
        self.right.set(keys.0 & MK_RBUTTON.0 != 0);
        if self.kind.get() != Kind::None {
            self.emit(DragEvent::Over { position: self.position(pt) });
        }
        if !effect.is_null() {
            unsafe { *effect = self.effect.get() };
        }
        Ok(())
    }

    fn DragLeave(&self) -> windows::core::Result<()> {
        if self.kind.replace(Kind::None) != Kind::None {
            self.emit(DragEvent::Leave);
        }
        Ok(())
    }

    fn Drop(
        &self,
        data: Ref<'_, IDataObject>,
        _keys: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let kind = self.kind.replace(Kind::None);
        if !effect.is_null() {
            unsafe { *effect = self.effect.get() };
        }
        let Some(data) = data.as_ref() else { return Ok(()) };
        if kind == Kind::None {
            return Ok(());
        }
        let (paths, error) = match kind {
            Kind::Files => (hdrop_paths(data), None),
            _ => match save(data, kind) {
                Ok(paths) => (paths, None),
                Err(e) => (Vec::new(), Some(e)),
            },
        };
        self.emit(DragEvent::Drop {
            paths,
            position: self.position(pt),
            saving: kind != Kind::Files,
            right_button: self.right.get(),
            error,
        });
        Ok(())
    }
}

thread_local! {
    /// Keeps the registered targets alive for the life of the window (main thread only).
    static TARGETS: RefCell<Vec<IDropTarget>> = const { RefCell::new(Vec::new()) };
}

unsafe extern "system" fn collect_child(hwnd: HWND, lparam: LPARAM) -> BOOL {
    unsafe { (*(lparam.0 as *mut Vec<HWND>)).push(hwnd) };
    true.into()
}

/// Registers the drop target on the webview's windows, in place of the one Tauri registered.
/// Call on the main thread, after the webview exists.
pub fn install(window: &tauri::WebviewWindow) -> Result<(), String> {
    // Files of earlier drops that were never moved to their destination.
    std::thread::spawn(|| {
        let _ = std::fs::remove_dir_all(temp_root());
    });

    let top = com::hwnd_of(window)?;
    let app = window.app_handle().clone();
    let mut children: Vec<HWND> = Vec::new();
    let _ = unsafe { EnumChildWindows(Some(top), Some(collect_child), LPARAM(&mut children as *mut _ as isize)) };
    let mut registered = Vec::new();
    for hwnd in children {
        let target: IDropTarget =
            Target {
            hwnd,
            app: app.clone(),
            kind: Cell::new(Kind::None),
            effect: Cell::new(DROPEFFECT_NONE),
            right: Cell::new(false),
        }
        .into();
        let revoked = unsafe { RevokeDragDrop(hwnd) };
        if revoked != Err(DRAGDROP_E_INVALIDHWND.into()) && unsafe { RegisterDragDrop(hwnd, &target) }.is_ok() {
            registered.push(target);
        }
    }
    if registered.is_empty() {
        return Err("no window to register the drop target on".into());
    }
    TARGETS.with(|t| *t.borrow_mut() = registered);
    Ok(())
}

// ---------------------------------------------------------------- right-button drop (Shell menu)

/// The Shell's own drop target of `folder`, as Explorer uses for its folder windows.
fn shell_drop_target(hwnd: HWND, folder: &str) -> Result<IDropTarget, String> {
    let sf = crate::context_menu::shell_folder(folder)?;
    unsafe { sf.CreateViewObject::<IDropTarget>(hwnd) }.map_err(com::err)
}

/// Replays a right-button drop of `sources` on the Shell's drop target of `folder`. The Shell
/// shows its menu at `pt` (screen): copy / move / shortcut plus the items of drag-and-drop
/// handler extensions (FastCopy, archivers), and carries out the choice itself.
fn right_drop_blocking(hwnd: HWND, sources: &[String], folder: &str, pt: POINT) -> Result<(), String> {
    let data = crate::dragdrop::build_data_object(sources)?;
    let target = shell_drop_target(hwnd, folder)?;
    let at = POINTL { x: pt.x, y: pt.y };
    let allowed = DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK;
    unsafe {
        // Without this the menu does not close when the user clicks elsewhere.
        let _ = SetForegroundWindow(hwnd);
        let mut effect = allowed;
        target.DragEnter(&data, MK_RBUTTON, at, &mut effect).map_err(com::err)?;
        let mut effect = allowed;
        let _ = target.DragOver(MK_RBUTTON, at, &mut effect);
        // As in a real drag: the button is up by the time of the drop; the target remembers it.
        let mut effect = allowed;
        target.Drop(&data, MODIFIERKEYS_FLAGS(0), at, &mut effect).map_err(com::err)
    }
}

/// Shows the Shell's right-button drop menu for `sources` dropped on `folder` and lets the Shell
/// do what is chosen. (`x`, `y`) is the drop position in physical pixels inside the window, as
/// in the `drag-drop` event.
pub async fn right_drop(
    window: tauri::WebviewWindow,
    sources: Vec<String>,
    folder: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let raw = com::hwnd_of(&window)?.0 as isize;
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let hwnd = HWND(raw as *mut core::ffi::c_void);
            let mut pt = POINT { x: x.round() as i32, y: y.round() as i32 };
            let _ = unsafe { ClientToScreen(hwnd, &mut pt) };
            let _ = tx.send(right_drop_blocking(hwnd, &sources, &folder, pt));
        })
        .map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "drop menu was dropped".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::ManuallyDrop;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::Com::STGMEDIUM_0;
    use windows::Win32::System::Memory::{GMEM_MOVEABLE, GlobalAlloc};
    use windows::Win32::UI::Shell::SHCreateDataObject;

    fn descriptor(files: &[(&str, u32, u32, u64)]) -> Vec<u8> {
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

    #[test]
    fn descriptor_files_reads_names_sizes_and_folders() {
        let bytes = descriptor(&[("画像.png", 0x40, 0, 5), ("sub", 0x4, 0x10, 0), ("b.txt", 0, 0, 0)]);
        assert_eq!(
            descriptor_files(&bytes),
            vec![
                VirtualFile { name: "画像.png".into(), directory: false, size: Some(5) },
                VirtualFile { name: "sub".into(), directory: true, size: None },
                VirtualFile { name: "b.txt".into(), directory: false, size: None },
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
        let names = vec!["a.png".to_string(), "A.PNG".to_string(), "a.png".to_string(), "b".to_string(), "b".to_string()];
        assert_eq!(distinct_names(names), vec!["a.png", "A (2).PNG", "a (3).png", "b", "b (2)"]);
    }

    #[test]
    fn url_shortcut_takes_web_addresses_only() {
        let (name, text) = url_shortcut("https://example.com/a/b?c=1").unwrap();
        assert_eq!(name, "example.com.url");
        assert_eq!(text, "[InternetShortcut]\r\nURL=https://example.com/a/b?c=1\r\n");
        assert_eq!(url_shortcut("HTTP://Example.com:8080/").unwrap().0, "example.com.url");
        // Only the first line: nothing else may be written into the shortcut file.
        assert_eq!(url_shortcut("https://a.example/x\r\nIconFile=evil").unwrap().1, "[InternetShortcut]\r\nURL=https://a.example/x\r\n");
        assert!(url_shortcut("file:///C:/Windows/notepad.exe").is_none());
        assert!(url_shortcut("javascript:alert(1)").is_none());
        assert!(url_shortcut("https://").is_none());
        assert!(url_shortcut("").is_none());
    }

    fn set_global(data: &IDataObject, format: FORMATETC, bytes: &[u8]) {
        unsafe {
            let handle: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1)).unwrap();
            let p = GlobalLock(handle) as *mut u8;
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
            let _ = GlobalUnlock(handle);
            let medium = STGMEDIUM {
                tymed: TYMED_HGLOBAL.0 as u32,
                u: STGMEDIUM_0 { hGlobal: handle },
                pUnkForRelease: ManuallyDrop::new(None),
            };
            data.SetData(&format, &medium, true).unwrap();
        }
    }

    fn empty_data_object() -> IDataObject {
        com::init_sta();
        unsafe { SHCreateDataObject(None, None, None).unwrap() }
    }

    #[test]
    fn virtual_files_are_saved_with_safe_names() {
        let data = empty_data_object();
        assert_eq!(kind_of(&data), Kind::None);
        // One file only: the Shell's data object keeps a single FileContents, whatever its index.
        // The memory block is larger than the file; the size in the descriptor cuts it.
        let files = descriptor(&[(r"..\picture.png", 0x40, 0, 5)]);
        set_global(&data, global(descriptor_format()), &files);
        set_global(&data, formatetc(contents_format(), 0, TYMED_HGLOBAL.0 as u32), b"12345+padding");
        assert_eq!(kind_of(&data), Kind::Virtual);

        let dir = tempfile::tempdir().unwrap();
        let written = save_virtual(&data, dir.path()).unwrap();
        assert_eq!(written, vec![dir.path().join("picture.png")]);
        assert_eq!(std::fs::read(&written[0]).unwrap(), b"12345");
    }

    /// The first half of a right-button drop (the drop itself would open the menu).
    #[test]
    fn the_shell_drop_target_of_a_folder_takes_files() {
        com::init_sta();
        let from = tempfile::tempdir().unwrap();
        let to = tempfile::tempdir().unwrap();
        let file = from.path().join("a.txt");
        std::fs::write(&file, b"x").unwrap();
        let data = crate::dragdrop::build_data_object(&[file.to_string_lossy().into_owned()]).unwrap();
        let target = shell_drop_target(HWND::default(), &to.path().to_string_lossy()).unwrap();
        let mut effect = DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK;
        unsafe {
            target.DragEnter(&data, MK_RBUTTON, POINTL { x: 0, y: 0 }, &mut effect).unwrap();
            target.DragLeave().unwrap();
        }
        assert_ne!(effect, DROPEFFECT_NONE);
    }

    #[test]
    fn a_url_is_saved_as_an_internet_shortcut() {
        let data = empty_data_object();
        let wide: Vec<u8> = "https://example.com/page\0".encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
        set_global(&data, global(url_format()), &wide);
        assert_eq!(kind_of(&data), Kind::Url);

        let dir = tempfile::tempdir().unwrap();
        let written = save_url(&data, dir.path()).unwrap();
        assert_eq!(written, vec![dir.path().join("example.com.url")]);
        assert_eq!(std::fs::read_to_string(&written[0]).unwrap(), "[InternetShortcut]\r\nURL=https://example.com/page\r\n");
    }
}
