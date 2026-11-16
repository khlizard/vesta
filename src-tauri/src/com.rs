//! COM / Shell helpers shared by every module.
//!
//! Shell APIs must run on STA threads. Tauri commands run on the async runtime,
//! so blocking Shell work is sent to one of the STA pools defined here.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CoInitializeEx, CoTaskMemFree, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
};
use windows::Win32::System::Ole::OleInitialize;
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    ILFree, IShellItem, SHCreateItemFromParsingName, SHParseDisplayName, SIGDN,
    SIGDN_DESKTOPABSOLUTEPARSING, SIGDN_NORMALDISPLAY,
};

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
                            let guard = rx.lock().expect("sta queue poisoned");
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
            .map_err(|_| "STA pool is closed".to_string())?;
        orx.await.map_err(|_| "STA job was dropped".to_string())?
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
            .map_err(|_| "STA pool is closed".to_string())?;
        orx.recv().map_err(|_| "STA job was dropped".to_string())?
    }

    /// Queues `f` without waiting for it.
    pub fn spawn<F>(&self, f: F)
    where
        F: FnOnce() + Send + 'static,
    {
        let _ = self.tx.send(Box::new(move || {
            if let Err(e) = catch_unwind(AssertUnwindSafe(f)) {
                eprintln!("STA job panicked: {}", panic_message(e));
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

/// Single thread for file operations and the clipboard (keeps undo history ordered).
pub fn op_pool() -> &'static StaPool {
    static POOL: OnceLock<StaPool> = OnceLock::new();
    POOL.get_or_init(|| StaPool::new("sta-op", 1))
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

/// Native window handle of a Tauri window.
pub fn hwnd_of(window: &tauri::WebviewWindow) -> Result<HWND, String> {
    let h = window.hwnd().map_err(|e| e.to_string())?;
    Ok(HWND(h.0 as _))
}

/// Formats a `windows::core::Error` as a short message for the frontend.
pub fn err(e: windows::core::Error) -> String {
    format!("{} (0x{:08X})", e.message(), e.code().0 as u32)
}
