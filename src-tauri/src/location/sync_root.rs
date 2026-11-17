//! Cloud-files sync roots (OneDrive, Dropbox): whether a path is inside one, and where it starts.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use windows::Win32::Storage::CloudFilters::{
    CF_SYNC_ROOT_BASIC_INFO, CF_SYNC_ROOT_INFO_CLASS, CfGetSyncRootInfoByPath,
};
use windows::core::PCWSTR;

use crate::com::{lock, wide};

/// Answers by path key (`crate::path::key`).
type Cache = Mutex<HashMap<String, bool>>;

fn sync_cache() -> &'static Cache {
    static C: OnceLock<Cache> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// True when `path` is inside a cloud-files sync root. Results are cached per path;
/// a cached sync-root ancestor answers for its descendants.
pub fn is_sync_root(path: &str) -> bool {
    cached(sync_cache(), path, in_sync_root)
}

/// The answer for `path` from `cache`, or from `ask` (and then kept).
fn cached(cache: &Cache, path: &str, ask: impl FnOnce(&str) -> bool) -> bool {
    let key = crate::path::key(path);
    {
        let cache = lock(cache);
        if let Some(&v) = cache.get(&key) {
            return v;
        }
        let mut p = key.as_str();
        while let Some(i) = p.rfind('\\') {
            p = &p[..i];
            if cache.get(p) == Some(&true) {
                return true;
            }
        }
    }
    // Asked without holding the lock: the answer can take a while.
    let ok = ask(path);
    lock(cache).insert(key, ok);
    ok
}

/// Asks the cloud files API.
fn in_sync_root(path: &str) -> bool {
    let w = wide(path);
    let mut buf = [0u8; std::mem::size_of::<CF_SYNC_ROOT_BASIC_INFO>() + 8];
    unsafe {
        CfGetSyncRootInfoByPath(
            PCWSTR(w.as_ptr()),
            CF_SYNC_ROOT_INFO_CLASS(0), // CF_SYNC_ROOT_INFO_BASIC
            buf.as_mut_ptr() as *mut _,
            buf.len() as u32,
            None,
        )
    }
    .is_ok()
}

/// The topmost folder of `path` (itself included) for which `inside` holds, walking up while
/// the parent still does. `None` when `path` itself does not.
fn topmost_while(path: &str, inside: impl Fn(&str) -> bool) -> Option<String> {
    let mut p = path.trim_end_matches('\\');
    if !inside(p) {
        return None;
    }
    while let Some(i) = p.rfind('\\') {
        let parent = &p[..i];
        // `C:` and the `\\server` part of a network path are not folders to ask about.
        let server_only = parent.starts_with(r"\\") && !parent[2..].contains('\\');
        if parent.len() < 3 || server_only || !inside(parent) {
            break;
        }
        p = parent;
    }
    Some(p.to_string())
}

/// Path of the cloud sync root that `path` is in, or `None` outside one.
pub fn sync_root_of(path: &str) -> Option<String> {
    topmost_while(path, is_sync_root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn topmost_while_walks_up_to_the_root_of_the_region() {
        let inside = |p: &str| p.to_lowercase().starts_with(r"d:\users\a\dropbox");
        assert_eq!(topmost_while(r"D:\Users\a\Dropbox\Work\x\", inside).as_deref(), Some(r"D:\Users\a\Dropbox"));
        assert_eq!(topmost_while(r"D:\Users\a\Dropbox", inside).as_deref(), Some(r"D:\Users\a\Dropbox"));
        assert_eq!(topmost_while(r"D:\Users\a", inside), None);
        // A whole drive or share: stops at its first folder level without asking about `D:` or `\\server`.
        assert_eq!(topmost_while(r"D:\a\b", |_| true).as_deref(), Some(r"D:\a"));
        assert_eq!(topmost_while(r"\\srv\share\a", |_| true).as_deref(), Some(r"\\srv\share"));
    }

    #[test]
    fn answers_are_cached_and_a_sync_root_answers_for_what_is_below_it() {
        let cache = Cache::default();
        let asked = RefCell::new(Vec::<String>::new());
        let ask = |answer: bool| {
            let asked = &asked;
            move |p: &str| {
                asked.borrow_mut().push(p.to_string());
                answer
            }
        };

        // Asked once; the same folder written another way is the same key.
        assert!(cached(&cache, r"D:\Dropbox", ask(true)));
        assert!(cached(&cache, r"d:\dropbox\", ask(false)));
        assert_eq!(*asked.borrow(), vec![r"D:\Dropbox"]);

        // Anything below a known sync root is in it, without asking (and without a new entry).
        assert!(cached(&cache, r"D:\Dropbox\Work\x", ask(false)));
        assert_eq!(asked.borrow().len(), 1);
        assert_eq!(lock(&cache).len(), 1);
        // A name that only starts the same way is not below it.
        assert!(!cached(&cache, r"D:\Dropbox2", ask(false)));
        assert_eq!(asked.borrow().len(), 2);

        // "Not a sync root" says nothing about what is below: a sync root may start further down.
        assert!(!cached(&cache, r"D:\Users", ask(false)));
        assert!(cached(&cache, r"D:\Users\a\OneDrive", ask(true)));
        assert!(!cached(&cache, r"D:\Users\a", ask(false)));
        assert_eq!(asked.borrow().len(), 5);
        // ... and the "no" is remembered too.
        assert!(!cached(&cache, r"D:\Users", ask(true)));
        assert_eq!(asked.borrow().len(), 5);
    }

    /// Prints the sync root of a real folder: set VESTA_TEST_SYNC_PATH and run with --ignored.
    #[test]
    #[ignore]
    fn sync_root_of_real_folder() {
        let Ok(path) = std::env::var("VESTA_TEST_SYNC_PATH") else { return };
        println!("sync_root_of({path}) = {:?}", sync_root_of(&path));
    }
}
