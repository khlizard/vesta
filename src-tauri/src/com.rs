//! COM / Shell helpers shared by every module.
//!
//! Shell APIs must run on STA threads. Tauri commands run on the async runtime,
//! so blocking Shell work is sent to one of the STA pools defined here.
//!
//! What runs where (each module's `pub async fn` picks its thread; `lib.rs` only calls them):
//!
//! | Thread | Work | Why there |
//! |---|---|---|
//! | main thread (`on_main`, window subclasses) | context menu (`context_menu`), starting a drag (`dragdrop`), the window's drop target (`droptarget`), right-button drop (`shelldrop`) | they need the window and its message loop (menus, OLE drag and drop) |
//! | `sta-list` x4 (`list_pool`) | listing folders, resolving locations, ancestors, shortcut targets, free space | quick queries; a slow network folder holds up one thread only |
//! | `sta-icon` x4 (`icon_pool`) | icons and thumbnails (`icons`) | many and slow; must not hold up listings |
//! | `sta-op` x1 (`op_pool`) | file operations and undo (`fileops`) | one at a time, so the undo history stays ordered |
//! | `sta-clip` x1 (`clip_pool`) | the clipboard (`clipboard`) | must answer while a long file operation runs |
//! | `sta-launch` x2 (`launch_pool`) | opening items (`launch`) | the Shell may show a dialog and block the thread until it is closed |
//! | blocking threads (`blocking`) | state files, settings, applying the watch list, updates | disk and network waits, no COM |
//!
//! The STA pool threads run no message loop: they block on their queue between jobs.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::thread;

use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{DeleteObject, GetDC, HBITMAP, HDC, ReleaseDC};
use windows::Win32::Storage::FileSystem::FindClose;
use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoInitializeEx, CoTaskMemFree};
use windows::Win32::System::DataExchange::{CloseClipboard, OpenClipboard};
use windows::Win32::System::Ole::OleInitialize;
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    ILFree, IShellItem, SHCreateItemFromParsingName, SHParseDisplayName, SIGDN, SIGDN_DESKTOPABSOLUTEPARSING,
    SIGDN_NORMALDISPLAY, SetWindowSubclass,
};
use windows::core::{PCWSTR, PWSTR};

type Job = Box<dyn FnOnce() + Send + 'static>;

/// A fixed set of threads initialised as COM STA (and OLE) that run queued jobs.
pub struct StaPool {
    tx: mpsc::Sender<Job>,
}

impl StaPool {
    pub fn new(name: &str, threads: usize) -> Self {
        let (tx, rx) = mpsc::channel::<Job>();
        let rx = Arc::new(Mutex::new(rx));
        for i in 0..threads.max(1) {
            let rx = Arc::clone(&rx);
            thread::Builder::new()
                .name(format!("{name}-{i}"))
                .spawn(move || {
                    init_sta();
                    loop {
                        let job = {
                            let guard = lock(&rx);
                            guard.recv()
                        };
                        match job {
                            Ok(job) => job(),
                            Err(_) => break,
                        }
                    }
                })
                .expect("failed to spawn STA thread");
        }
        Self { tx }
    }

    /// Runs `f` on a pool thread and waits for the result without blocking the async runtime.
    ///
    /// The `catch_unwind` here (and in `run_blocking` / `spawn`) only works in debug and test
    /// builds. A release build is compiled with `panic = "abort"`: there a panic runs the hook
    /// of `startup::install_panic_hook` (crash.log and a message) and ends the process.
    pub async fn run<R, F>(&self, f: F) -> Result<R, String>
    where
        R: Send + 'static,
        F: FnOnce() -> R + Send + 'static,
    {
        let (otx, orx) = tokio::sync::oneshot::channel();
        self.tx
            .send(Box::new(move || {
                let result = catch_unwind(AssertUnwindSafe(f)).map_err(panic_message);
                let _ = otx.send(result);
            }))
            .map_err(|_| "処理を始められません（作業スレッドが止まっています）".to_string())?;
        orx.await.map_err(|_| "処理が途中で止まりました".to_string())?
    }

    /// Runs `f` on a pool thread and blocks the caller until it finishes (used by tests).
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn run_blocking<R, F>(&self, f: F) -> Result<R, String>
    where
        R: Send + 'static,
        F: FnOnce() -> R + Send + 'static,
    {
        let (otx, orx) = mpsc::channel();
        self.tx
            .send(Box::new(move || {
                let result = catch_unwind(AssertUnwindSafe(f)).map_err(panic_message);
                let _ = otx.send(result);
            }))
            .map_err(|_| "処理を始められません（作業スレッドが止まっています）".to_string())?;
        orx.recv().map_err(|_| "処理が途中で止まりました".to_string())?
    }

    /// Queues `f` without waiting for it.
    pub fn spawn<F>(&self, f: F)
    where
        F: FnOnce() + Send + 'static,
    {
        let _ = self.tx.send(Box::new(move || {
            if let Err(e) = catch_unwind(AssertUnwindSafe(f)) {
                crate::logfile::line(&format!("STA job panicked: {}", panic_message(e)));
            }
        }));
    }
}

fn panic_message(e: Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = e.downcast_ref::<&str>() {
        format!("panic: {s}")
    } else if let Some(s) = e.downcast_ref::<String>() {
        format!("panic: {s}")
    } else {
        "panic".to_string()
    }
}

/// Locks `m`. A lock poisoned by a panic on another thread is taken all the same: the data
/// under the locks of this app (caches, queues, lists) is whole between any two statements.
pub fn lock<T: ?Sized>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Initialises COM (STA) and OLE on the current thread. Safe to call more than once.
pub fn init_sta() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        let _ = OleInitialize(None);
    }
}

/// Pool for folder listing, location resolving and other quick Shell queries.
pub fn list_pool() -> &'static StaPool {
    static POOL: OnceLock<StaPool> = OnceLock::new();
    POOL.get_or_init(|| StaPool::new("sta-list", 4))
}

/// Pool for icon and thumbnail extraction.
pub fn icon_pool() -> &'static StaPool {
    static POOL: OnceLock<StaPool> = OnceLock::new();
    POOL.get_or_init(|| StaPool::new("sta-icon", 4))
}

/// Single thread for file operations and undo (keeps undo history ordered).
pub fn op_pool() -> &'static StaPool {
    static POOL: OnceLock<StaPool> = OnceLock::new();
    POOL.get_or_init(|| StaPool::new("sta-op", 1))
}

/// Single thread for the clipboard: apart from file operations, so copying a name or pasting
/// does not wait for a long copy to end.
pub fn clip_pool() -> &'static StaPool {
    static POOL: OnceLock<StaPool> = OnceLock::new();
    POOL.get_or_init(|| StaPool::new("sta-clip", 1))
}

/// Threads for opening items. The Shell may show a dialog (a security warning, an error) that
/// blocks the thread until it is closed: that must not take a listing thread, and with two
/// threads another item can still be opened meanwhile.
pub fn launch_pool() -> &'static StaPool {
    static POOL: OnceLock<StaPool> = OnceLock::new();
    POOL.get_or_init(|| StaPool::new("sta-launch", 2))
}

/// Null-terminated UTF-16 copy of `s`.
pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Reads a UTF-16 buffer up to the first NUL.
pub fn from_wide_buf(buf: &[u16]) -> String {
    let n = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..n])
}

/// Converts a CoTaskMem-allocated string to `String` and frees it.
pub fn take_cotaskmem_string(p: PWSTR) -> String {
    if p.is_null() {
        return String::new();
    }
    let s = unsafe { p.to_string() }.unwrap_or_default();
    unsafe { CoTaskMemFree(Some(p.0 as *const _)) };
    s
}

/// Creates a Shell item from a file system path or Shell parsing name.
pub fn shell_item(parsing: &str) -> windows::core::Result<IShellItem> {
    let w = wide(parsing);
    unsafe { SHCreateItemFromParsingName(PCWSTR(w.as_ptr()), None) }
}

pub fn item_name(item: &IShellItem, sigdn: SIGDN) -> windows::core::Result<String> {
    let p = unsafe { item.GetDisplayName(sigdn)? };
    Ok(take_cotaskmem_string(p))
}

/// File system path for real items, `::{GUID}...` style name for virtual items.
pub fn parsing_name(item: &IShellItem) -> windows::core::Result<String> {
    item_name(item, SIGDN_DESKTOPABSOLUTEPARSING)
}

/// Name as Explorer shows it.
pub fn display_name(item: &IShellItem) -> windows::core::Result<String> {
    item_name(item, SIGDN_NORMALDISPLAY)
}

/// Owned absolute PIDL.
pub struct Pidl(pub *mut ITEMIDLIST);

// A PIDL is plain memory owned by this struct.
unsafe impl Send for Pidl {}

impl Pidl {
    pub fn from_parsing(parsing: &str) -> windows::core::Result<Self> {
        let w = wide(parsing);
        let mut p: *mut ITEMIDLIST = std::ptr::null_mut();
        unsafe { SHParseDisplayName(PCWSTR(w.as_ptr()), None, &mut p, 0, None)? };
        Ok(Self(p))
    }

    pub fn as_ptr(&self) -> *const ITEMIDLIST {
        self.0
    }
}

impl Drop for Pidl {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { ILFree(Some(self.0)) };
        }
    }
}

/// A window handle that can go to another thread (an `HWND` holds a raw pointer, which the
/// compiler does not let cross threads). The handle itself is valid from any thread.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Hwnd(isize);

impl Hwnd {
    /// No window: dialogs get no parent.
    pub const NONE: Self = Self(0);

    pub fn of(window: &tauri::WebviewWindow) -> Result<Self, String> {
        hwnd_of(window).map(|h| Self(h.0 as isize))
    }

    /// The handle of `window`, or `NONE` when it cannot be had.
    pub fn of_or_none(window: &tauri::WebviewWindow) -> Self {
        Self::of(window).unwrap_or(Self::NONE)
    }

    pub fn is_none(self) -> bool {
        self.0 == 0
    }

    pub fn get(self) -> HWND {
        HWND(self.0 as _)
    }
}

/// Native window handle of a Tauri window.
pub fn hwnd_of(window: &tauri::WebviewWindow) -> Result<HWND, String> {
    let h = window.hwnd().map_err(|e| e.to_string())?;
    Ok(HWND(h.0 as _))
}

/// Installs `proc` as a subclass of the window (`id` tells the subclasses of the app apart).
/// Call on the main thread.
pub fn subclass(
    window: &tauri::WebviewWindow,
    proc: unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM, usize, usize) -> LRESULT,
    id: usize,
) -> Result<(), String> {
    let hwnd = hwnd_of(window)?;
    let ok = unsafe { SetWindowSubclass(hwnd, Some(proc), id, 0) };
    if ok.as_bool() {
        Ok(())
    } else {
        Err("SetWindowSubclass failed".into())
    }
}

/// Runs `f` on the main thread and waits for what it returns, without blocking the async
/// runtime. `what` names the request in the error of one that was dropped unanswered.
pub async fn on_main<R, F>(window: &tauri::WebviewWindow, what: &str, f: F) -> Result<R, String>
where
    R: Send + 'static,
    F: FnOnce() -> R + Send + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(f());
        })
        .map_err(|e| e.to_string())?;
    rx.await.map_err(|_| format!("処理が途中で止まりました（{what}）"))
}

/// Runs `f` on the runtime's blocking threads (work that waits on the disk or the network and
/// needs no COM) and waits for what it returns.
pub async fn blocking<R, F>(f: F) -> Result<R, String>
where
    R: Send + 'static,
    F: FnOnce() -> R + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

/// Formats a `windows::core::Error` as a short message for the frontend.
pub fn err(e: windows::core::Error) -> String {
    format!("{} (0x{:08X})", e.message(), e.code().0 as u32)
}

// ---------------------------------------------------------------------------------------------
// Guards: Win32 resources that are given back when the guard is dropped.

/// The clipboard, opened by this thread; closed when dropped.
pub struct OpenClipboardGuard(());

impl OpenClipboardGuard {
    /// OpenClipboard fails while another process holds it; retry briefly.
    pub fn open() -> Result<Self, String> {
        let mut last = None;
        for _ in 0..20 {
            match unsafe { OpenClipboard(None) } {
                Ok(()) => return Ok(Self(())),
                Err(e) => last = Some(e),
            }
            thread::sleep(std::time::Duration::from_millis(25));
        }
        Err(last.map(err).unwrap_or_default())
    }
}

impl Drop for OpenClipboardGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseClipboard();
        }
    }
}

/// A search handle of FindFirstFile; closed when dropped.
pub struct FindGuard(pub HANDLE);

impl Drop for FindGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = FindClose(self.0);
        }
    }
}

/// A bitmap that is ours; deleted when dropped.
pub struct BitmapGuard(pub HBITMAP);

impl Drop for BitmapGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteObject(self.0.into());
        }
    }
}

/// The device context of the screen; released when dropped.
pub struct ScreenDc(pub HDC);

impl ScreenDc {
    pub fn get() -> Self {
        Self(unsafe { GetDC(None) })
    }
}

impl Drop for ScreenDc {
    fn drop(&mut self) {
        unsafe {
            ReleaseDC(None, self.0);
        }
    }
}
