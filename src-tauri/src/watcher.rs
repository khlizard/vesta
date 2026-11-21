//! Watches the folders of shown panes and emits `folder-changed` { location }: 200ms after the
//! last change, or at the latest 1.5s after the first one (a folder that keeps changing, such as
//! a download in progress, still refreshes).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher as _};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::com::lock;
use crate::path;

const QUIET: Duration = Duration::from_millis(200);
const MAX_WAIT: Duration = Duration::from_millis(1500);

/// Collects change notifications per location and reports those that have been quiet long
/// enough, or that have been waiting since their first change for `max_wait`.
#[derive(Debug)]
pub struct Debouncer {
    quiet: Duration,
    max_wait: Duration,
    /// Per location: (first pending event, last event).
    pending: HashMap<String, (Instant, Instant)>,
}

impl Debouncer {
    pub fn new(quiet: Duration, max_wait: Duration) -> Self {
        Self {
            quiet,
            max_wait,
            pending: HashMap::new(),
        }
    }

    pub fn touch(&mut self, location: &str, now: Instant) {
        self.pending
            .entry(location.to_string())
            .and_modify(|e| e.1 = now)
            .or_insert((now, now));
    }

    fn due_at(&self, first: Instant, last: Instant) -> Instant {
        (last + self.quiet).min(first + self.max_wait)
    }

    /// Removes and returns the locations that are due.
    pub fn take_due(&mut self, now: Instant) -> Vec<String> {
        let due: Vec<String> = self
            .pending
            .iter()
            .filter(|&(_, &(first, last))| now >= self.due_at(first, last))
            .map(|(k, _)| k.clone())
            .collect();
        for k in &due {
            self.pending.remove(k);
        }
        due
    }

    /// Time until the next location becomes due (`None` when nothing is pending).
    pub fn next_wait(&self, now: Instant) -> Option<Duration> {
        self.pending
            .values()
            .map(|&(first, last)| self.due_at(first, last).saturating_duration_since(now))
            .min()
    }
}

#[derive(Clone)]
struct Watched {
    /// Normalised path.
    key: String,
    path: PathBuf,
    /// Exact string passed to `set`.
    location: String,
}

/// Maps an event path to the watched location it belongs to.
fn match_location<'a>(watched: &'a [Watched], event_path: &Path) -> Option<&'a Watched> {
    let p = path::key(&event_path.to_string_lossy());
    let parent = event_path.parent().map(|x| path::key(&x.to_string_lossy()));
    watched
        .iter()
        .find(|w| w.key == p || parent.as_deref() == Some(w.key.as_str()))
}

/// How often folders are checked for having gone away or come back.
const ALIVE_EVERY: Duration = Duration::from_secs(3);

/// What is asked to be watched: the folders that are, and those that cannot be right now.
#[derive(Default)]
struct Lists {
    watched: Vec<Watched>,
    /// Asked for, but not there (deleted, unplugged, offline share) or not watchable. Checked
    /// again by `check_alive`.
    lost: Vec<Watched>,
}

struct Shared {
    watcher: Mutex<Option<RecommendedWatcher>>,
    lists: Mutex<Lists>,
}

impl Shared {
    fn lists(&self) -> std::sync::MutexGuard<'_, Lists> {
        lock(&self.lists)
    }

    fn watch(&self, path: &Path) -> bool {
        let mut w = lock(&self.watcher);
        w.as_mut()
            .is_some_and(|w| w.watch(path, RecursiveMode::NonRecursive).is_ok())
    }

    fn unwatch(&self, path: &Path) {
        let mut w = lock(&self.watcher);
        if let Some(w) = w.as_mut() {
            let _ = w.unwatch(path);
        }
    }

    /// Moves folders that went away to `lost` and watches lost ones that are back. Returns the
    /// locations whose state changed: their panes must be read again.
    ///
    /// The watcher itself says nothing when a folder it watches disappears (it just stops), and
    /// a folder that is not there cannot be watched; so this is asked on a timer.
    fn check_alive(&self) -> Vec<String> {
        let (watched, lost) = {
            let l = self.lists();
            (l.watched.clone(), l.lost.clone())
        };
        // Checked without holding the lock: an offline share can take many seconds to answer.
        let gone: Vec<Watched> = watched.into_iter().filter(|w| !w.path.is_dir()).collect();
        let back: Vec<Watched> = lost.into_iter().filter(|w| w.path.is_dir()).collect();
        let mut changed = Vec::new();
        for w in gone {
            let mut l = self.lists();
            // Still asked for? (`set` may have run meanwhile.)
            if let Some(i) = l.watched.iter().position(|x| x.key == w.key) {
                let w = l.watched.remove(i);
                drop(l);
                self.unwatch(&w.path);
                changed.push(w.location.clone());
                self.lists().lost.push(w);
            }
        }
        for w in back {
            if !self.lists().lost.iter().any(|x| x.key == w.key) || !self.watch(&w.path) {
                continue;
            }
            let mut l = self.lists();
            if let Some(i) = l.lost.iter().position(|x| x.key == w.key) {
                let w = l.lost.remove(i);
                changed.push(w.location.clone());
                l.watched.push(w);
            } else {
                drop(l);
                self.unwatch(&w.path);
            }
        }
        changed
    }

    /// Replaces the set asked for. Virtual locations are ignored. With `fresh`, folders that are
    /// already watched are watched anew (a watch can stop without a word, e.g. after a network
    /// drop that was over before `check_alive` looked).
    fn set(&self, locations: Vec<String>, fresh: bool) {
        let old: Vec<Watched> = std::mem::take(&mut self.lists().watched);
        if fresh {
            for o in &old {
                self.unwatch(&o.path);
            }
        }
        let mut next = Lists::default();
        for loc in locations {
            if path::is_virtual(&loc) {
                continue;
            }
            let key = path::key(&loc);
            if next.watched.iter().chain(&next.lost).any(|n| n.key == key) {
                continue;
            }
            if !fresh && let Some(o) = old.iter().find(|o| o.key == key) {
                next.watched.push(Watched {
                    location: loc,
                    ..o.clone()
                });
                continue;
            }
            let path = PathBuf::from(&loc);
            let w = Watched {
                key,
                path,
                location: loc,
            };
            if w.path.is_dir() && self.watch(&w.path) {
                next.watched.push(w);
            } else {
                next.lost.push(w);
            }
        }
        if !fresh {
            for o in &old {
                if !next.watched.iter().any(|n| n.key == o.key) {
                    self.unwatch(&o.path);
                }
            }
        }
        *self.lists() = next;
    }
}

/// The set asked for (locations, `fresh`) on its way to being applied.
type Request = (Vec<String>, bool);

/// Requests come in from any thread and are applied one at a time, the newest last.
#[derive(Default)]
struct Requests {
    /// The newest request that has not been applied yet.
    waiting: Mutex<Option<Request>>,
    /// Held while requests are applied.
    applying: Mutex<()>,
}

impl Requests {
    /// Only the newest request is kept. `fresh` is kept until applied.
    fn put(&self, locations: Vec<String>, fresh: bool) {
        let mut w = lock(&self.waiting);
        let fresh = fresh || w.as_ref().is_some_and(|(_, f)| *f);
        *w = Some((locations, fresh));
    }

    fn take(&self) -> Option<Request> {
        lock(&self.waiting).take()
    }

    /// Hands the waiting request to `set`, and those that arrive while it runs. Calls from
    /// several threads run one after the other, so a slow `set` (an offline share) cannot
    /// finish after the `set` of a newer request and undo it.
    fn apply(&self, set: impl Fn(Vec<String>, bool)) {
        let _one_at_a_time = lock(&self.applying);
        while let Some((locations, fresh)) = self.take() {
            set(locations, fresh);
        }
    }
}

pub struct Watcher {
    shared: Arc<Shared>,
    requests: Requests,
}

impl Watcher {
    pub fn new(app: AppHandle) -> Self {
        let (tx, rx) = mpsc::channel::<String>();
        let shared = Self::shared(tx.clone());

        std::thread::Builder::new()
            .name("folder-watch-debounce".into())
            .spawn(move || {
                let mut deb = Debouncer::new(QUIET, MAX_WAIT);
                loop {
                    let msg = match deb.next_wait(Instant::now()) {
                        Some(d) => rx.recv_timeout(d),
                        None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
                    };
                    match msg {
                        Ok(loc) => deb.touch(&loc, Instant::now()),
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                    for loc in deb.take_due(Instant::now()) {
                        let _ = app.emit("folder-changed", json!({ "location": loc }));
                    }
                }
            })
            .expect("failed to spawn watcher thread");

        let alive = Arc::clone(&shared);
        std::thread::Builder::new()
            .name("folder-watch-alive".into())
            .spawn(move || {
                loop {
                    std::thread::sleep(ALIVE_EVERY);
                    for loc in alive.check_alive() {
                        if tx.send(loc).is_err() {
                            return;
                        }
                    }
                }
            })
            .expect("failed to spawn watcher thread");

        Self {
            shared,
            requests: Requests::default(),
        }
    }

    /// The watcher sending the location of every change to `tx`.
    fn shared(tx: mpsc::Sender<String>) -> Arc<Shared> {
        let shared = Arc::new(Shared {
            watcher: Mutex::new(None),
            lists: Mutex::default(),
        });
        let s2 = Arc::downgrade(&shared);
        let handler = move |res: notify::Result<notify::Event>| {
            let (Ok(ev), Some(shared)) = (res, s2.upgrade()) else {
                return;
            };
            let lists = shared.lists();
            for p in &ev.paths {
                if let Some(w) = match_location(&lists.watched, p) {
                    let _ = tx.send(w.location.clone());
                }
            }
        };
        *lock(&shared.watcher) = match notify::recommended_watcher(handler) {
            Ok(w) => Some(w),
            Err(e) => {
                // Without it the lists do not refresh on their own (F5 still works).
                crate::logfile::line(&format!("folder watcher could not start: {e}"));
                None
            }
        };
        shared
    }

    /// Notes the set to watch; `apply` (on a worker thread: checking an offline share can take
    /// many seconds) then makes it so. Only the newest request is kept and requests are applied
    /// one at a time, so requests that overtake each other still end with the last one.
    pub fn request(&self, locations: Vec<String>, fresh: bool) {
        self.requests.put(locations, fresh);
    }

    /// Applies the newest request, if another call has not taken it already. Returns once no
    /// request is waiting; a call that finds another one at work waits for it.
    pub fn apply(&self) {
        self.requests
            .apply(|locations, fresh| self.shared.set(locations, fresh));
    }
}

/// Sets the folders to watch (the `watch_folders` command): notes the request, then applies it
/// off the async runtime and returns when it is in effect.
pub async fn watch(app: AppHandle, locations: Vec<String>, fresh: bool) -> Result<(), String> {
    app.state::<Watcher>().request(locations, fresh);
    crate::com::blocking(move || app.state::<Watcher>().apply()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debounce_waits_for_quiet() {
        let t0 = Instant::now();
        let ms = Duration::from_millis;
        let mut d = Debouncer::new(ms(200), ms(1500));
        assert_eq!(d.next_wait(t0), None);
        d.touch("a", t0);
        assert_eq!(d.next_wait(t0 + ms(50)), Some(ms(150)));
        d.touch("a", t0 + ms(150));
        d.touch("b", t0 + ms(160));
        assert!(d.take_due(t0 + ms(300)).is_empty());
        let mut due = d.take_due(t0 + ms(350));
        due.sort();
        assert_eq!(due, vec!["a"]);
        assert_eq!(d.take_due(t0 + ms(360)), vec!["b"]);
        assert_eq!(d.next_wait(t0 + ms(400)), None);
    }

    #[test]
    fn debounce_does_not_wait_forever() {
        let t0 = Instant::now();
        let ms = Duration::from_millis;
        let mut d = Debouncer::new(ms(200), ms(1500));
        // A change every 100ms never becomes quiet; it is still reported after 1.5s.
        for i in 0..14 {
            d.touch("a", t0 + ms(i * 100));
            assert!(d.take_due(t0 + ms(i * 100 + 50)).is_empty());
        }
        d.touch("a", t0 + ms(1400));
        assert_eq!(d.next_wait(t0 + ms(1400)), Some(ms(100)));
        assert_eq!(d.take_due(t0 + ms(1500)), vec!["a"]);
        // The next change starts a new wait.
        d.touch("a", t0 + ms(1510));
        assert!(d.take_due(t0 + ms(1600)).is_empty());
        assert_eq!(d.take_due(t0 + ms(1710)), vec!["a"]);
    }

    /// Waits for a change of `location` to arrive (the watcher reports from its own thread).
    fn changed(rx: &mpsc::Receiver<String>, location: &str) -> bool {
        let until = Instant::now() + Duration::from_secs(5);
        while let Ok(loc) = rx.recv_timeout(until.saturating_duration_since(Instant::now())) {
            if loc == location {
                return true;
            }
        }
        false
    }

    #[test]
    fn a_folder_that_went_away_is_watched_again_when_it_is_back() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("watched");
        std::fs::create_dir(&dir).unwrap();
        let loc = dir.to_string_lossy().into_owned();
        let (tx, rx) = mpsc::channel();
        let shared = Watcher::shared(tx);
        shared.set(vec![loc.clone()], false);
        assert!(shared.check_alive().is_empty());
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        assert!(changed(&rx, &loc), "no change reported while watched");

        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(
            shared.check_alive(),
            vec![loc.clone()],
            "the pane must be told the folder is gone"
        );
        assert!(shared.check_alive().is_empty());

        std::fs::create_dir(&dir).unwrap();
        assert_eq!(shared.check_alive(), vec![loc.clone()], "and that it is back");
        while rx.try_recv().is_ok() {}
        std::fs::write(dir.join("b.txt"), "x").unwrap();
        assert!(changed(&rx, &loc), "no change reported after the folder came back");
    }

    #[test]
    fn a_folder_that_is_not_there_yet_is_watched_once_it_appears() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("later");
        let loc = dir.to_string_lossy().into_owned();
        let (tx, rx) = mpsc::channel();
        let shared = Watcher::shared(tx);
        shared.set(vec![loc.clone(), "::{virtual}".into()], false);
        assert!(shared.check_alive().is_empty());
        std::fs::create_dir(&dir).unwrap();
        assert_eq!(shared.check_alive(), vec![loc.clone()]);
        std::fs::write(dir.join("a.txt"), "x").unwrap();
        assert!(changed(&rx, &loc));
        // Asking for something else stops it.
        shared.set(Vec::new(), false);
        assert!(shared.lists().watched.is_empty() && shared.lists().lost.is_empty());
    }

    #[test]
    fn a_fresh_set_keeps_reporting() {
        let tmp = tempfile::tempdir().unwrap();
        let loc = tmp.path().to_string_lossy().into_owned();
        let (tx, rx) = mpsc::channel();
        let shared = Watcher::shared(tx);
        shared.set(vec![loc.clone()], false);
        shared.set(vec![loc.clone()], true);
        assert_eq!(shared.lists().watched.len(), 1);
        std::fs::write(tmp.path().join("a.txt"), "x").unwrap();
        assert!(changed(&rx, &loc));
    }

    #[test]
    fn a_slow_request_does_not_undo_a_newer_one() {
        let requests = Arc::new(Requests::default());
        // What was set, in the order the sets finished.
        let applied = Arc::new(Mutex::new(Vec::<Request>::new()));
        let (started_tx, started_rx) = mpsc::channel::<()>();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let release_rx = Mutex::new(release_rx);

        requests.put(vec!["first".into()], true);
        let slow = {
            let (requests, applied) = (Arc::clone(&requests), Arc::clone(&applied));
            std::thread::spawn(move || {
                requests.apply(|locations, fresh| {
                    // The first set hangs (as on an offline share) until it is released.
                    if locations == ["first"] {
                        let _ = started_tx.send(());
                        let _ = lock(&release_rx).recv_timeout(Duration::from_secs(5));
                    }
                    lock(&applied).push((locations, fresh));
                });
            })
        };
        started_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("the first set did not start");

        requests.put(vec!["second".into()], false);
        let quick = {
            let (requests, applied) = (Arc::clone(&requests), Arc::clone(&applied));
            std::thread::spawn(move || requests.apply(|locations, fresh| lock(&applied).push((locations, fresh))))
        };
        // Time for the second call to finish first, were it not made to wait.
        std::thread::sleep(Duration::from_millis(100));
        assert!(
            lock(&applied).is_empty(),
            "a newer request was applied while an older one was at work"
        );
        release_tx.send(()).unwrap();
        slow.join().unwrap();
        quick.join().unwrap();

        assert_eq!(
            *lock(&applied),
            vec![(vec!["first".to_string()], true), (vec!["second".to_string()], false)]
        );
        assert!(requests.take().is_none());
    }

    #[test]
    fn only_the_newest_waiting_request_is_applied_and_fresh_is_kept() {
        let requests = Requests::default();
        requests.put(vec!["a".into()], true);
        requests.put(vec!["b".into()], false);
        let applied = Mutex::new(Vec::new());
        requests.apply(|locations, fresh| lock(&applied).push((locations, fresh)));
        assert_eq!(*lock(&applied), vec![(vec!["b".to_string()], true)]);
    }

    #[test]
    fn maps_event_paths() {
        let w = vec![Watched {
            key: path::key("C:\\Foo\\"),
            path: PathBuf::from("C:\\Foo"),
            location: "C:\\Foo".into(),
        }];
        assert!(match_location(&w, Path::new("c:\\foo")).is_some());
        assert!(match_location(&w, Path::new("C:\\FOO\\x.txt")).is_some());
        assert!(match_location(&w, Path::new("C:\\foo\\sub\\x.txt")).is_none());
        assert!(match_location(&w, Path::new("C:\\other\\x.txt")).is_none());
    }
}
