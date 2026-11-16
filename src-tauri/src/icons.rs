//! `icon://` and `thumb://` URI scheme handlers.
//!
//! - `http://icon.localhost/?loc=<percent-encoded location>&size=16[&k=<d|f>&m=<modified>]`
//! - `http://thumb.localhost/?loc=<percent-encoded location>&size=96&k=<d|f>&m=<modified>`
//!   (WebView2 rewrites custom schemes to `http://<scheme>.localhost/`; only the query is used.)
//!
//! Both answer `image/png`. Called on an STA thread from `crate::com::icon_pool()`.

use std::num::NonZeroUsize;
use std::sync::{Mutex, OnceLock};

use lru::LruCache;
use tauri::http::{Request, Response};
use windows::core::Interface;
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS, HBITMAP,
};
use windows::Win32::UI::Shell::{
    IShellItemImageFactory, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY, SIIGBF_RESIZETOFIT, SIIGBF,
};

use crate::com::shell_item;

type Png = std::sync::Arc<Vec<u8>>;

const FULL_KEY_EXTS: &[&str] = &["exe", "lnk", "url", "ico", "cur", "ani", "msc", "appref-ms", "scr"];

fn icon_cache() -> &'static Mutex<LruCache<String, Png>> {
    static C: OnceLock<Mutex<LruCache<String, Png>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(LruCache::new(NonZeroUsize::new(2000).unwrap())))
}

/// Thumbnails are limited by their total size, not their count: one 512px image can be over 1 MB.
const THUMB_CACHE_BYTES: usize = 64 * 1024 * 1024;

/// An LRU cache that also keeps the total size of its images under `max_bytes`.
struct ByteLru {
    map: LruCache<String, Png>,
    bytes: usize,
    max_bytes: usize,
}

impl ByteLru {
    fn new(max_bytes: usize) -> Self {
        Self { map: LruCache::unbounded(), bytes: 0, max_bytes }
    }

    fn get(&mut self, key: &str) -> Option<Png> {
        self.map.get(key).cloned()
    }

    fn put(&mut self, key: String, png: Png) {
        self.bytes += png.len();
        if let Some(old) = self.map.put(key, png) {
            self.bytes -= old.len();
        }
        // The newest entry stays even when it alone is over the limit.
        while self.bytes > self.max_bytes && self.map.len() > 1 {
            match self.map.pop_lru() {
                Some((_, old)) => self.bytes -= old.len(),
                None => break,
            }
        }
    }
}

fn thumb_cache() -> &'static Mutex<ByteLru> {
    static C: OnceLock<Mutex<ByteLru>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(ByteLru::new(THUMB_CACHE_BYTES)))
}

struct Query {
    loc: String,
    size: i32,
    /// Kind and modified time of a listed item (`k` / `m`), "" when not given.
    item: String,
    raw: String,
}

fn parse_query(req: &Request<Vec<u8>>) -> Option<Query> {
    let raw = req.uri().query()?.to_string();
    let mut loc = None;
    let mut size = 16;
    let (mut kind, mut modified) = (String::new(), String::new());
    for (k, v) in url::form_urlencoded::parse(raw.as_bytes()) {
        match k.as_ref() {
            "loc" => loc = Some(v.into_owned()),
            "size" => size = v.parse::<i32>().ok()?,
            "k" => kind = v.into_owned(),
            "m" => modified = v.into_owned(),
            _ => {}
        }
    }
    let loc = loc.filter(|l| !l.is_empty())?;
    let item = if kind.is_empty() && modified.is_empty() { String::new() } else { format!("{kind}:{modified}") };
    Some(Query { loc, size: size.clamp(8, 1024), item, raw })
}

/// Cache key for an icon: per extension for ordinary files, per location otherwise.
/// A per-location key includes `item` (kind and modified time), so a folder that replaced a file
/// of the same name, or a rewritten .exe / .lnk, does not get the old icon.
fn icon_key(loc: &str, size: i32, item: &str) -> String {
    let ext = if loc.starts_with("::") {
        None
    } else {
        std::path::Path::new(loc)
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
    };
    let per_ext = match &ext {
        Some(e) if !FULL_KEY_EXTS.contains(&e.as_str()) => {
            // Folders with a dot in their name must not share an extension key. A listed item
            // says what it is (`d:` / `f:`); only other callers cost a disk (or network) access.
            if item.starts_with("f:") {
                true
            } else if item.starts_with("d:") {
                false
            } else {
                std::fs::metadata(loc).map(|m| !m.is_dir()).unwrap_or(false)
            }
        }
        _ => false,
    };
    if per_ext {
        format!("ext:{}:{size}", ext.unwrap())
    } else {
        format!("loc:{}:{size}:{item}", loc.to_lowercase())
    }
}

/// "The data necessary to complete this operation is not yet available."
const E_PENDING: windows::core::HRESULT = windows::core::HRESULT(0x8000_000A_u32 as i32);

/// Waits between tries while the Shell is still fetching an image (about 1.1 s in all).
const PENDING_WAITS_MS: [u64; 6] = [20, 40, 80, 150, 300, 500];

/// What one try at an image gave.
enum Tried {
    Image(Vec<u8>),
    /// The Shell is fetching it in the background (E_PENDING), or handed over an empty bitmap
    /// in the meantime. Seen for cloud sync roots (Dropbox) right after start. Worth another try.
    NotReady,
    Failed,
}

fn try_image(factory: &IShellItemImageFactory, size: i32, flags: SIIGBF) -> Tried {
    match unsafe { factory.GetImage(SIZE { cx: size, cy: size }, flags) } {
        Ok(hbm) => {
            let png = hbitmap_to_png(hbm);
            unsafe {
                let _ = DeleteObject(hbm.into());
            }
            png.map_or(Tried::NotReady, Tried::Image)
        }
        Err(e) if e.code() == E_PENDING => Tried::NotReady,
        Err(_) => Tried::Failed,
    }
}

/// Tries `attempt` again after each of `waits_ms` for as long as it says "not ready".
fn retry_while_not_ready(waits_ms: &[u64], mut attempt: impl FnMut() -> Tried) -> Option<Vec<u8>> {
    let mut waits = waits_ms.iter();
    loop {
        match attempt() {
            Tried::Image(png) => return Some(png),
            Tried::Failed => return None,
            Tried::NotReady => std::thread::sleep(std::time::Duration::from_millis(*waits.next()?)),
        }
    }
}

fn get_image(loc: &str, size: i32, flags: SIIGBF) -> Option<Vec<u8>> {
    let item = shell_item(loc).ok()?;
    let factory: IShellItemImageFactory = item.cast().ok()?;
    retry_while_not_ready(&PENDING_WAITS_MS, || try_image(&factory, size, flags))
}

fn hbitmap_to_png(hbm: HBITMAP) -> Option<Vec<u8>> {
    let mut bm = BITMAP::default();
    let got = unsafe {
        GetObjectW(
            hbm.into(),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut _ as *mut _),
        )
    };
    if got == 0 || bm.bmWidth <= 0 || bm.bmHeight <= 0 {
        return None;
    }
    let (w, h) = (bm.bmWidth as usize, bm.bmHeight as usize);
    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w as i32,
            biHeight: -(h as i32), // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut px = vec![0u8; w * h * 4];
    let hdc = unsafe { GetDC(None) };
    let lines = unsafe {
        GetDIBits(hdc, hbm, 0, h as u32, Some(px.as_mut_ptr() as *mut _), &mut bmi, DIB_RGB_COLORS)
    };
    unsafe { ReleaseDC(None, hdc) };
    // All zero: nothing was drawn (an image the Shell has not fetched yet), not a picture.
    if lines == 0 || px.iter().all(|&b| b == 0) {
        return None;
    }
    bgra_to_rgba(&mut px);
    encode_png(w as u32, h as u32, &px)
}

/// In-place BGRA(premultiplied) -> RGBA(straight). All-zero alpha means an opaque bitmap.
fn bgra_to_rgba(px: &mut [u8]) {
    let (pixels, _) = px.as_chunks_mut::<4>();
    let any_alpha = pixels.iter().any(|p| p[3] != 0);
    for p in pixels.iter_mut() {
        let (b, g, r) = (p[0], p[1], p[2]);
        if !any_alpha {
            p[0] = r;
            p[1] = g;
            p[2] = b;
            p[3] = 255;
        } else {
            let a = p[3] as u32;
            let un = |c: u8| -> u8 {
                if a == 0 || a == 255 { c } else { ((c as u32 * 255 + a / 2) / a).min(255) as u8 }
            };
            p[0] = un(r);
            p[1] = un(g);
            p[2] = un(b);
        }
    }
}

fn encode_png(w: u32, h: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::Fast);
        let mut wr = enc.write_header().ok()?;
        wr.write_image_data(rgba).ok()?;
    }
    Some(out)
}

fn ok_png(png: &Png) -> Response<Vec<u8>> {
    Response::builder()
        .status(200)
        .header("Content-Type", "image/png")
        .header("Cache-Control", "max-age=3600")
        .body(png.as_ref().clone())
        .unwrap_or_else(|_| not_found())
}

pub fn icon_response(req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some(q) = parse_query(req) else { return not_found() };
    let key = icon_key(&q.loc, q.size, &q.item);
    if let Some(hit) = icon_cache().lock().unwrap().get(&key).cloned() {
        return ok_png(&hit);
    }
    let Some(png) = get_image(&q.loc, q.size, SIIGBF_ICONONLY) else { return not_found() };
    let png = Png::new(png);
    icon_cache().lock().unwrap().put(key, png.clone());
    ok_png(&png)
}

pub fn thumb_response(req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some(q) = parse_query(req) else { return not_found() };
    if let Some(hit) = thumb_cache().lock().unwrap().get(&q.raw) {
        return ok_png(&hit);
    }
    let png = get_image(&q.loc, q.size, SIIGBF_BIGGERSIZEOK | SIIGBF_RESIZETOFIT)
        .or_else(|| get_image(&q.loc, q.size, SIIGBF_ICONONLY));
    let Some(png) = png else { return not_found() };
    let png = Png::new(png);
    thumb_cache().lock().unwrap().put(q.raw, png.clone());
    ok_png(&png)
}

pub fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(404)
        .body(Vec::new())
        .expect("static response")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn byte_lru_drops_old_images_over_the_limit() {
        let img = |n: usize| Png::new(vec![0u8; n]);
        let mut c = ByteLru::new(100);
        c.put("a".into(), img(40));
        c.put("b".into(), img(40));
        assert!(c.get("a").is_some()); // "a" is now the most recently used
        c.put("c".into(), img(40));
        assert!(c.get("b").is_none());
        assert!(c.get("a").is_some() && c.get("c").is_some());
        assert_eq!(c.bytes, 80);
        // Replacing an entry counts its new size only; one oversized image is still kept.
        c.put("a".into(), img(500));
        assert!(c.get("a").is_some());
        assert_eq!((c.map.len(), c.bytes), (1, 500));
    }

    #[test]
    fn icon_key_uses_the_listed_kind_without_touching_the_disk() {
        // Neither path exists: the kind from the listing decides.
        assert_eq!(icon_key("Z:\\none\\a.txt", 16, "f:1"), "ext:txt:16");
        assert_eq!(icon_key("Z:\\none\\v1.0", 16, "d:1"), "loc:z:\\none\\v1.0:16:d:1");
        assert_eq!(icon_key("Z:\\none\\a.exe", 16, "f:1"), "loc:z:\\none\\a.exe:16:f:1");
    }
    fn req(scheme: &str, loc: &str, size: i32) -> Request<Vec<u8>> {
        let enc = url::form_urlencoded::byte_serialize(loc.as_bytes()).collect::<String>();
        Request::builder()
            .uri(format!("http://{scheme}.localhost/?loc={enc}&size={size}"))
            .body(Vec::new())
            .unwrap()
    }

    fn is_png(r: &Response<Vec<u8>>) -> bool {
        r.status() == 200 && r.body().starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A])
    }

    #[test]
    fn icon_for_file_dir_and_cache() {
        crate::com::init_sta();
        let d = tempfile::tempdir().unwrap();
        let f1 = d.path().join("a.txt");
        let f2 = d.path().join("b.txt");
        std::fs::write(&f1, b"x").unwrap();
        std::fs::write(&f2, b"y").unwrap();
        let r = icon_response(&req("icon", &f1.to_string_lossy(), 16));
        assert!(is_png(&r));
        assert_eq!(r.headers()["Cache-Control"], "max-age=3600");
        // same extension: served from the cache (b.txt would otherwise be a distinct key)
        let k2 = icon_key(&f2.to_string_lossy(), 16, "");
        assert!(icon_cache().lock().unwrap().contains(&k2));
        assert!(is_png(&icon_response(&req("icon", &f2.to_string_lossy(), 16))));
        assert_ne!(icon_key(&f1.to_string_lossy(), 16, ""), icon_key(&f1.to_string_lossy(), 32, ""));
        // per-extension keys do not depend on the item
        assert_eq!(icon_key(&f1.to_string_lossy(), 16, "f:1"), icon_key(&f1.to_string_lossy(), 16, "f:2"));

        let r = icon_response(&req("icon", &d.path().to_string_lossy(), 16));
        assert!(is_png(&r));
        let dir = d.path().to_string_lossy();
        assert!(icon_key(&dir, 16, "").starts_with("loc:"));
        // per-location keys: a folder and a file of the same name, or a newer version, differ
        assert_ne!(icon_key(&dir, 16, "d:1"), icon_key(&dir, 16, "f:1"));
        assert_ne!(icon_key(&dir, 16, "d:1"), icon_key(&dir, 16, "d:2"));

        assert_eq!(icon_response(&req("icon", "C:\\no\\such\\file.txt", 16)).status(), 404);
        let t = thumb_response(&req("thumb", &f1.to_string_lossy(), 96));
        assert!(is_png(&t));
    }

    #[test]
    fn an_image_that_is_not_ready_is_tried_again() {
        let attempts = |results: Vec<Tried>| {
            let mut results = results.into_iter();
            let mut count = 0;
            let got = retry_while_not_ready(&[0, 0], || {
                count += 1;
                results.next().unwrap()
            });
            (got, count)
        };
        assert_eq!(attempts(vec![Tried::Image(vec![1])]), (Some(vec![1]), 1));
        assert_eq!(attempts(vec![Tried::NotReady, Tried::NotReady, Tried::Image(vec![2])]), (Some(vec![2]), 3));
        // A real failure is not retried; "not ready" gives up after the last wait.
        assert_eq!(attempts(vec![Tried::Failed, Tried::Image(vec![3])]), (None, 1));
        assert_eq!(attempts(vec![Tried::NotReady, Tried::NotReady, Tried::NotReady, Tried::Image(vec![4])]), (None, 3));
    }

    /// Asks for the icon of a real folder from several threads at once, as a starting window
    /// does: set VESTA_TEST_ICON_PATH and run with --ignored --nocapture.
    #[test]
    #[ignore]
    fn icon_of_real_folder_from_several_threads() {
        let Ok(path) = std::env::var("VESTA_TEST_ICON_PATH") else { return };
        let threads: Vec<_> = (0..6)
            .map(|n| {
                let path = path.clone();
                std::thread::spawn(move || {
                    crate::com::init_sta();
                    for round in 0..3 {
                        let size = get_image(&path, 16, SIIGBF_ICONONLY).map(|p| p.len());
                        println!("thread {n} round {round}: {size:?}");
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
    }

    /// Does asking for the icon or the thumbnail of an online-only file download it? Put the path
    /// of such a file (a small image in a cloud folder) in the file named by VESTA_TEST_ONLINE_ONLY
    /// and run with --ignored --nocapture. Result: docs/poc.md.
    #[test]
    #[ignore]
    fn online_only_file_stays_online_only() {
        use std::os::windows::fs::MetadataExt;
        const RECALL_ON_DATA_ACCESS: u32 = 0x40_0000;
        let Ok(list) = std::env::var("VESTA_TEST_ONLINE_ONLY") else { return };
        let path = std::fs::read_to_string(list).unwrap().trim().trim_start_matches('\u{feff}').to_string();
        let online_only = || {
            // Downloading is asynchronous: give it time to start.
            std::thread::sleep(std::time::Duration::from_secs(4));
            std::fs::metadata(&path).unwrap().file_attributes() & RECALL_ON_DATA_ACCESS != 0
        };
        crate::com::init_sta();
        println!("before: online-only = {}", online_only());
        let icon = get_image(&path, 16, SIIGBF_ICONONLY).map(|p| p.len());
        println!("icon: {icon:?}, online-only = {}", online_only());
        let thumb = get_image(&path, 256, SIIGBF_BIGGERSIZEOK | SIIGBF_RESIZETOFIT).map(|p| p.len());
        println!("thumbnail: {thumb:?}, online-only = {}", online_only());
    }

    #[test]
    fn alpha_conversion() {
        let mut px = [0u8, 0, 128, 128, 10, 20, 30, 0];
        bgra_to_rgba(&mut px);
        // any alpha present: first pixel un-premultiplied, second left transparent
        assert_eq!(px[3], 128);
        assert_eq!(px[0], 255);
        assert_eq!(px[7], 0);
        let mut opaque = [1u8, 2, 3, 0];
        bgra_to_rgba(&mut opaque);
        assert_eq!(opaque, [3, 2, 1, 255]);
    }
}
