//! One IFileOperation run: the progress sink that notes what happened to each item, and what
//! the run amounts to (`Outcome`).

use std::sync::{Arc, Mutex};

use windows::Win32::System::Com::{CLSCTX_ALL, CoCreateInstance};
use windows::Win32::UI::Shell::{
    COPYENGINE_S_USER_IGNORED, FILEOPERATION_FLAGS, FOF_NOCONFIRMATION, FOF_NOCONFIRMMKDIR, FOF_NOERRORUI,
    FOF_SILENT, FileOperation, IFileOperation, IFileOperationProgressSink, IFileOperationProgressSink_Impl,
    IShellItem,
};
use windows::core::{HRESULT, PCWSTR, Ref, implement};

use crate::com::{self, Hwnd, err, parsing_name};
use crate::types::OpResult;

/// HRESULT_FROM_WIN32(ERROR_CANCELLED)
const E_CANCELLED: i32 = 0x800704C7u32 as i32;

pub(super) const NO_FLAGS: FILEOPERATION_FLAGS = FILEOPERATION_FLAGS(0);
pub(super) const NO_SINK: Option<&IFileOperationProgressSink> = None;

// ---------------------------------------------------------------------------------------------
// Progress sink

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Kind {
    Copy,
    Move,
    Rename,
    New,
    Delete,
}

pub(super) struct Event {
    pub(super) kind: Kind,
    /// Parsing name of the source item (empty for NewItem).
    pub(super) source: String,
    /// Parsing name of the newly created item.
    pub(super) created: Option<String>,
    pub(super) hr: HRESULT,
}

impl Event {
    /// The item was really processed: success, and not one the user chose to skip.
    fn done(&self) -> bool {
        self.hr.is_ok() && self.hr != COPYENGINE_S_USER_IGNORED
    }
}

type Events = Arc<Mutex<Vec<Event>>>;

#[implement(IFileOperationProgressSink)]
struct Sink {
    events: Events,
}

impl Sink {
    fn push(&self, kind: Kind, src: Option<&IShellItem>, new: Option<&IShellItem>, hr: HRESULT) {
        let source = src
            .and_then(|i| parsing_name(i).ok())
            .unwrap_or_default();
        // For deletes this is the `$R...` path of the item in the Recycle Bin.
        let created = new.and_then(|n| parsing_name(n).ok());
        com::lock(&self.events).push(Event { kind, source, created, hr });
    }
}

#[allow(non_snake_case)]
impl IFileOperationProgressSink_Impl for Sink_Impl {
    fn StartOperations(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn FinishOperations(&self, _hr: HRESULT) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreRenameItem(&self, _f: u32, _i: Ref<IShellItem>, _n: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostRenameItem(
        &self,
        _f: u32,
        item: Ref<IShellItem>,
        _n: &PCWSTR,
        hr: HRESULT,
        new: Ref<IShellItem>,
    ) -> windows::core::Result<()> {
        self.push(Kind::Rename, item.as_ref(), new.as_ref(), hr);
        Ok(())
    }
    fn PreMoveItem(
        &self,
        _f: u32,
        _i: Ref<IShellItem>,
        _d: Ref<IShellItem>,
        _n: &PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostMoveItem(
        &self,
        _f: u32,
        item: Ref<IShellItem>,
        _d: Ref<IShellItem>,
        _n: &PCWSTR,
        hr: HRESULT,
        new: Ref<IShellItem>,
    ) -> windows::core::Result<()> {
        self.push(Kind::Move, item.as_ref(), new.as_ref(), hr);
        Ok(())
    }
    fn PreCopyItem(
        &self,
        _f: u32,
        _i: Ref<IShellItem>,
        _d: Ref<IShellItem>,
        _n: &PCWSTR,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostCopyItem(
        &self,
        _f: u32,
        item: Ref<IShellItem>,
        _d: Ref<IShellItem>,
        _n: &PCWSTR,
        hr: HRESULT,
        new: Ref<IShellItem>,
    ) -> windows::core::Result<()> {
        self.push(Kind::Copy, item.as_ref(), new.as_ref(), hr);
        Ok(())
    }
    fn PreDeleteItem(&self, _f: u32, _i: Ref<IShellItem>) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostDeleteItem(
        &self,
        _f: u32,
        item: Ref<IShellItem>,
        hr: HRESULT,
        new: Ref<IShellItem>,
    ) -> windows::core::Result<()> {
        self.push(Kind::Delete, item.as_ref(), new.as_ref(), hr);
        Ok(())
    }
    fn PreNewItem(&self, _f: u32, _d: Ref<IShellItem>, _n: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }
    fn PostNewItem(
        &self,
        _f: u32,
        _d: Ref<IShellItem>,
        _n: &PCWSTR,
        _t: &PCWSTR,
        _a: u32,
        hr: HRESULT,
        new: Ref<IShellItem>,
    ) -> windows::core::Result<()> {
        self.push(Kind::New, None, new.as_ref(), hr);
        Ok(())
    }
    fn UpdateProgress(&self, _total: u32, _sofar: u32) -> windows::core::Result<()> {
        Ok(())
    }
    fn ResetTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn PauseTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn ResumeTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
}

// ---------------------------------------------------------------------------------------------
// IFileOperation session

pub(super) struct Outcome {
    pub(super) events: Vec<Event>,
    pub(super) aborted: bool,
    pub(super) perform_err: Option<String>,
}

impl Outcome {
    /// Events of the items the operation was asked for. The sink also reports every item inside
    /// a folder; those are left out (undoing the folder takes them along).
    pub(super) fn ok_events(&self, kind: Kind) -> impl Iterator<Item = &Event> {
        // A copied folder reports one event per file in it, so this must not compare every
        // event with every other: the done sources go into a set, and each event looks up its
        // own parents there (the cost follows the depth of the path, not the number of files).
        let done: Vec<&Event> = self.events.iter().filter(|e| e.kind == kind && e.done()).collect();
        let sources: std::collections::HashSet<String> = done.iter().map(|e| crate::path::key(&e.source)).collect();
        done.into_iter().filter(move |e| !crate::path::is_below_any(&e.source, &sources))
    }

    pub(super) fn any_ok(&self) -> bool {
        self.events.iter().any(Event::done)
    }

    pub(super) fn result(&self, created: Vec<String>) -> OpResult {
        OpResult { created, aborted: self.aborted, done: self.any_ok(), ..Default::default() }
    }

    /// Error when the operation failed for every item (cancelling is not an error).
    pub(super) fn check(&self) -> Result<(), String> {
        if self.any_ok() || self.aborted {
            return Ok(());
        }
        if let Some(e) = &self.perform_err {
            return Err(e.clone());
        }
        if let Some(e) = self.events.iter().find(|e| e.hr.is_err()) {
            return Err(hr_message(e.hr));
        }
        Ok(())
    }

    /// Like `check` but also fails when nothing succeeded (used by undo).
    pub(super) fn require_some(&self) -> Result<(), String> {
        self.check()?;
        if self.any_ok() {
            Ok(())
        } else if self.aborted {
            Err("操作が中止されました".into())
        } else {
            Err("対象の項目がありませんでした".into())
        }
    }
}

fn hr_message(hr: HRESULT) -> String {
    err(windows::core::Error::from(hr))
}

/// Creates an IFileOperation with `flags`, lets `f` queue operations, performs them and
/// returns what the progress sink saw.
pub(super) fn run_session<F>(
    owner: Hwnd,
    flags: FILEOPERATION_FLAGS,
    silent: bool,
    f: F,
) -> Result<Outcome, String>
where
    F: FnOnce(&IFileOperation) -> windows::core::Result<()>,
{
    unsafe {
        let op: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL).map_err(err)?;
        if !owner.is_none() {
            op.SetOwnerWindow(owner.get()).map_err(err)?;
        }
        let mut fl = flags | FOF_NOCONFIRMMKDIR;
        if silent {
            fl = fl | FOF_SILENT | FOF_NOCONFIRMATION | FOF_NOERRORUI;
        }
        op.SetOperationFlags(fl).map_err(err)?;

        let events: Events = Arc::new(Mutex::new(Vec::new()));
        let sink: IFileOperationProgressSink = Sink { events: Arc::clone(&events) }.into();
        let cookie = op.Advise(&sink).map_err(err)?;

        let queued = f(&op);
        let perform = match queued {
            Ok(()) => op.PerformOperations(),
            Err(e) => Err(e),
        };
        let aborted = op.GetAnyOperationsAborted().map(|b| b.as_bool()).unwrap_or(false);
        let _ = op.Unadvise(cookie);

        let events = std::mem::take(&mut *com::lock(&events));
        let mut out = Outcome { events, aborted, perform_err: None };
        if let Err(e) = perform {
            if e.code().0 == E_CANCELLED {
                out.aborted = true;
            } else {
                out.perform_err = Some(err(e));
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Foundation::{E_ACCESSDENIED, S_OK};

    fn event(kind: Kind, source: &str, created: Option<&str>, hr: HRESULT) -> Event {
        Event { kind, source: source.into(), created: created.map(Into::into), hr }
    }

    fn outcome(events: Vec<Event>) -> Outcome {
        Outcome { events, aborted: false, perform_err: None }
    }

    #[test]
    fn ok_events_are_the_items_asked_for_that_were_processed() {
        let out = outcome(vec![
            event(Kind::Copy, r"C:\src\dir", Some(r"C:\dst\dir"), S_OK),
            // Items inside a folder that was copied itself are reported too, and left out.
            event(Kind::Copy, r"C:\src\dir\in.txt", Some(r"C:\dst\dir\in.txt"), S_OK),
            event(Kind::Copy, r"C:\src\DIR\sub\deep.txt", Some(r"C:\dst\dir\sub\deep.txt"), S_OK),
            // A name that only starts like the folder's is another item.
            event(Kind::Copy, r"C:\src\dir2", Some(r"C:\dst\dir2"), S_OK),
            event(Kind::Copy, r"C:\src\skipped.txt", None, COPYENGINE_S_USER_IGNORED),
            event(Kind::Copy, r"C:\src\denied.txt", None, E_ACCESSDENIED),
            event(Kind::Move, r"C:\src\moved.txt", Some(r"C:\dst\moved.txt"), S_OK),
        ]);
        let copied: Vec<&str> = out.ok_events(Kind::Copy).map(|e| e.source.as_str()).collect();
        assert_eq!(copied, vec![r"C:\src\dir", r"C:\src\dir2"]);
        let moved: Vec<&str> = out.ok_events(Kind::Move).map(|e| e.source.as_str()).collect();
        assert_eq!(moved, vec![r"C:\src\moved.txt"]);
        assert_eq!(out.ok_events(Kind::Delete).count(), 0);
        assert!(out.any_ok());
    }

    #[test]
    fn ok_events_of_a_big_folder_are_found_quickly() {
        // One folder with many files in it, as the sink reports a folder copy.
        let mut events = vec![event(Kind::Copy, r"C:\src\big", Some(r"C:\dst\big"), S_OK)];
        for i in 0..100_000 {
            let name = format!(r"C:\src\big\sub{}\f{i}.txt", i % 100);
            events.push(event(Kind::Copy, &name, Some(&name), S_OK));
        }
        events.push(event(Kind::Copy, r"C:\src\other.txt", Some(r"C:\dst\other.txt"), S_OK));
        let out = outcome(events);
        let started = std::time::Instant::now();
        let copied: Vec<&str> = out.ok_events(Kind::Copy).map(|e| e.source.as_str()).collect();
        assert_eq!(copied, vec![r"C:\src\big", r"C:\src\other.txt"]);
        // Comparing every pair took minutes at this size.
        assert!(started.elapsed() < std::time::Duration::from_secs(5), "{:?}", started.elapsed());
    }

    #[test]
    fn ok_events_keep_an_item_whose_folder_failed() {
        // The folder itself was not processed, so what is inside it stands for itself.
        let out = outcome(vec![
            event(Kind::Delete, r"C:\a\dir", None, E_ACCESSDENIED),
            event(Kind::Delete, r"C:\a\dir\x.txt", Some(r"C:\$Recycle.Bin\$R1.txt"), S_OK),
        ]);
        let deleted: Vec<&str> = out.ok_events(Kind::Delete).map(|e| e.source.as_str()).collect();
        assert_eq!(deleted, vec![r"C:\a\dir\x.txt"]);
    }

    #[test]
    fn check_fails_only_when_nothing_was_done_and_nothing_was_cancelled() {
        // One item done: fine, whatever else failed.
        let some = outcome(vec![
            event(Kind::Copy, "a", Some("b"), S_OK),
            event(Kind::Copy, "c", None, E_ACCESSDENIED),
        ]);
        assert_eq!(some.check(), Ok(()));
        assert_eq!(some.require_some(), Ok(()));

        // Every item failed: the error of the first one.
        let failed = outcome(vec![event(Kind::Copy, "a", None, E_ACCESSDENIED)]);
        let message = failed.check().unwrap_err();
        assert!(message.contains("0x80070005"), "{message}");
        assert_eq!(failed.require_some(), Err(message));

        // The error of the whole run comes before those of the items.
        let mut whole = outcome(vec![event(Kind::Copy, "a", None, E_ACCESSDENIED)]);
        whole.perform_err = Some("perform failed".into());
        assert_eq!(whole.check(), Err("perform failed".to_string()));

        // Cancelling is not an error, but nothing was done.
        let mut cancelled = outcome(vec![event(Kind::Copy, "a", None, E_ACCESSDENIED)]);
        cancelled.aborted = true;
        assert_eq!(cancelled.check(), Ok(()));
        assert_eq!(cancelled.require_some(), Err("操作が中止されました".to_string()));

        // Nothing happened at all, or everything was skipped by the user.
        assert_eq!(outcome(Vec::new()).check(), Ok(()));
        assert_eq!(outcome(Vec::new()).require_some(), Err("対象の項目がありませんでした".to_string()));
        let skipped = outcome(vec![event(Kind::Copy, "a", None, COPYENGINE_S_USER_IGNORED)]);
        assert!(!skipped.any_ok());
        assert_eq!(skipped.check(), Ok(()));
        assert_eq!(skipped.require_some(), Err("対象の項目がありませんでした".to_string()));
    }

    #[test]
    fn result_reports_what_the_run_amounts_to() {
        let mut out = outcome(vec![event(Kind::New, "", Some(r"C:\a\new"), S_OK)]);
        out.aborted = true;
        let r = out.result(vec![r"C:\a\new".to_string()]);
        assert_eq!(r.created, vec![r"C:\a\new".to_string()]);
        assert!(r.done && r.aborted && !r.undoable && !r.replaced);
        assert!(!outcome(Vec::new()).result(Vec::new()).done);
    }
}
