//! The undo history, and undoing its entries.
//!
//! Undoing is in three parts: `plan` decides from what is on disk what to do, `run` does it, and
//! `settle` decides what to tell the user and what stays in the history. Only `run` touches
//! anything, so the deciding parts are tested without files.

use std::collections::VecDeque;
use std::path::Path;
use std::sync::Mutex;

use windows::core::PCWSTR;

use super::session::{NO_FLAGS, NO_SINK, run_session};
use super::{recycle, recycle_bin, rename_raw};
use crate::com::{self, Hwnd, shell_item, wide};

const HISTORY_MAX: usize = 50;

#[derive(Debug, Clone, PartialEq)]
pub(super) enum Entry {
    /// `current` is the path after renaming.
    Rename { current: String, old_name: String },
    /// `(current, original)` path pairs.
    Move { items: Vec<(String, String)> },
    /// Created items; undo sends them to the Recycle Bin.
    Trash { paths: Vec<String>, label: &'static str },
    /// `(original path, `$R...` path of the item in the Recycle Bin)`.
    Restore { items: Vec<(String, String)> },
}

pub(super) fn history() -> &'static Mutex<VecDeque<Entry>> {
    static H: Mutex<VecDeque<Entry>> = Mutex::new(VecDeque::new());
    &H
}

pub(super) fn record(entry: Entry) {
    let mut h = com::lock(history());
    h.push_back(entry);
    while h.len() > HISTORY_MAX {
        h.pop_front();
    }
}

// ---------------------------------------------------------------------------------------------
// undo

pub(crate) fn undo_sync(owner: Hwnd, silent: bool) -> Result<Option<String>, String> {
    let entry = com::lock(history()).pop_back();
    let Some(entry) = entry else { return Ok(None) };
    let (result, left) = undo_entry(entry, owner, silent);
    // What could not be undone but is still there goes back, so the next undo tries it again
    // instead of silently moving on to the operation before it.
    if let Some(left) = left {
        record(left);
    }
    result.map(Some)
}

pub(super) const NOT_FOUND: &str = "元に戻す対象の項目が見つかりません";
pub(super) const NAME_TAKEN: &str = "元の場所に同じ名前の項目があるため、戻せません";

pub(super) fn exists(path: &str) -> bool {
    Path::new(path).exists()
}

/// What undoing gives: the message for the user (or the error), and the part of the entry that
/// was not undone and still can be.
type Undone = (Result<String, String>, Option<Entry>);

/// Undoes `entry`.
fn undo_entry(entry: Entry, owner: Hwnd, silent: bool) -> Undone {
    match plan(entry, exists) {
        Plan::Refuse { error, keep } => (Err(error.into()), keep),
        Plan::Run(step) => {
            let done = run(&step, owner, silent);
            settle(step, done, exists)
        }
        Plan::Restore(items) => {
            let results = recycle_bin::restore(&items, owner, silent);
            settle_restore(items, results, exists)
        }
    }
}

/// What undoing an entry comes to, given what is on disk now.
#[derive(Debug, PartialEq)]
enum Plan {
    /// Nothing can be done: the error to report, and what stays in the history.
    Refuse { error: &'static str, keep: Option<Entry> },
    /// One file operation.
    Run(Step),
    /// Items to take out of the Recycle Bin, each with its own result.
    Restore(Vec<(String, String)>),
}

/// One file operation that undoes an entry.
#[derive(Debug, Clone, PartialEq)]
enum Step {
    Rename { current: String, old_name: String },
    /// `free` are moved back. `blocked` have something at their original place now: they stay
    /// where they are, and in the history.
    Move { free: Vec<(String, String)>, blocked: Vec<(String, String)> },
    Trash { paths: Vec<String>, label: &'static str },
}

fn plan(entry: Entry, exists: impl Fn(&str) -> bool) -> Plan {
    match entry {
        Entry::Rename { current, old_name } => {
            if !exists(&current) {
                return Plan::Refuse { error: NOT_FOUND, keep: None };
            }
            Plan::Run(Step::Rename { current, old_name })
        }
        Entry::Move { items } => {
            // Never replaces what is at the original place now, like undoing a delete.
            let present: Vec<(String, String)> = items.into_iter().filter(|(c, _)| exists(c)).collect();
            let (blocked, free): (Vec<_>, Vec<_>) = present.into_iter().partition(|(_, o)| exists(o));
            if free.is_empty() {
                let error = if blocked.is_empty() { NOT_FOUND } else { NAME_TAKEN };
                let keep = (!blocked.is_empty()).then_some(Entry::Move { items: blocked });
                return Plan::Refuse { error, keep };
            }
            Plan::Run(Step::Move { free, blocked })
        }
        Entry::Trash { paths, label } => {
            let existing: Vec<String> = paths.into_iter().filter(|p| exists(p)).collect();
            if existing.is_empty() {
                return Plan::Refuse { error: NOT_FOUND, keep: None };
            }
            Plan::Run(Step::Trash { paths: existing, label })
        }
        // Whether an item can go back is looked at when it is its turn (`recycle_bin::restore`).
        Entry::Restore { items } => Plan::Restore(items),
    }
}

fn run(step: &Step, owner: Hwnd, silent: bool) -> Result<(), String> {
    match step {
        Step::Rename { current, old_name } => {
            rename_raw(current, old_name, owner, silent).and_then(|out| out.require_some())
        }
        Step::Move { free, .. } => run_session(owner, NO_FLAGS, silent, |op| unsafe {
            for (current, original) in free {
                let o = Path::new(original);
                let (Some(parent), Some(name)) = (o.parent().and_then(|p| p.to_str()), o.file_name())
                else {
                    continue;
                };
                let item = shell_item(current)?;
                let dest = shell_item(parent)?;
                let nw = wide(&name.to_string_lossy());
                op.MoveItem(&item, &dest, PCWSTR(nw.as_ptr()), NO_SINK)?;
            }
            Ok(())
        })
        .and_then(|out| out.require_some()),
        Step::Trash { paths, .. } => recycle(paths, owner, silent).and_then(|out| out.require_some()),
    }
}

/// After `step` ran with the result `done`: the message, and what is left to undo.
fn settle(step: Step, done: Result<(), String>, exists: impl Fn(&str) -> bool) -> Undone {
    match step {
        Step::Rename { current, old_name } => {
            // (Not just "still there": after undoing a change of case, `current` still matches.)
            let left = (done.is_err() && exists(&current)).then_some(Entry::Rename { current, old_name });
            (done.map(|()| "名前の変更を元に戻しました".into()), left)
        }
        Step::Move { free, blocked } => {
            let left: Vec<_> = free.into_iter().chain(blocked).filter(|(c, _)| exists(c)).collect();
            let done = match done {
                Ok(()) if left.is_empty() => Ok("移動を元に戻しました".into()),
                Ok(()) => Ok("移動を元に戻しました（戻せなかった項目があります）".into()),
                Err(e) => Err(e),
            };
            (done, (!left.is_empty()).then_some(Entry::Move { items: left }))
        }
        Step::Trash { paths, label } => {
            let left: Vec<String> = paths.into_iter().filter(|p| exists(p)).collect();
            (
                done.map(|()| format!("{label}を元に戻しました")),
                (!left.is_empty()).then_some(Entry::Trash { paths: left, label }),
            )
        }
    }
}

/// After restoring `items` with `results` (one for each, in order): the message, and what is
/// left to undo (the items that failed and are still in the Recycle Bin).
fn settle_restore(
    items: Vec<(String, String)>,
    results: Vec<Result<(), String>>,
    exists: impl Fn(&str) -> bool,
) -> Undone {
    let mut errors = Vec::new();
    let mut left = Vec::new();
    for ((original, bin_path), result) in items.into_iter().zip(results) {
        if let Err(e) = result {
            errors.push(format!("{original}: {e}"));
            if exists(&bin_path) {
                left.push((original, bin_path));
            }
        }
    }
    let done = if errors.is_empty() { Ok("削除を元に戻しました".into()) } else { Err(errors.join("\n")) };
    (done, (!left.is_empty()).then_some(Entry::Restore { items: left }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pair(a: &str, b: &str) -> (String, String) {
        (a.to_string(), b.to_string())
    }

    /// "Exists" for the paths listed.
    fn on_disk<'a>(paths: &'a [&'a str]) -> impl Fn(&str) -> bool + 'a {
        move |p| paths.contains(&p)
    }

    #[test]
    fn a_rename_is_undone_only_while_the_item_is_there() {
        let entry = Entry::Rename { current: r"C:\a\new.txt".into(), old_name: "old.txt".into() };
        assert_eq!(plan(entry.clone(), on_disk(&[])), Plan::Refuse { error: NOT_FOUND, keep: None });
        let step = Step::Rename { current: r"C:\a\new.txt".into(), old_name: "old.txt".into() };
        assert_eq!(plan(entry.clone(), on_disk(&[r"C:\a\new.txt"])), Plan::Run(step.clone()));

        // Done: nothing is left, even when the old path still "exists" (a change of case only).
        let (message, left) = settle(step.clone(), Ok(()), on_disk(&[r"C:\a\new.txt"]));
        assert_eq!(message, Ok("名前の変更を元に戻しました".to_string()));
        assert_eq!(left, None);
        // Failed and still there: stays in the history. Failed and gone: dropped.
        let (message, left) = settle(step.clone(), Err("denied".into()), on_disk(&[r"C:\a\new.txt"]));
        assert_eq!(message, Err("denied".to_string()));
        assert_eq!(left, Some(entry));
        assert_eq!(settle(step, Err("denied".into()), on_disk(&[])).1, None);
    }

    #[test]
    fn a_move_goes_back_only_where_the_original_place_is_free() {
        let a = pair(r"C:\dst\a.txt", r"C:\src\a.txt");
        let b = pair(r"C:\dst\b.txt", r"C:\src\b.txt");
        let gone = pair(r"C:\dst\gone.txt", r"C:\src\gone.txt");
        let entry = Entry::Move { items: vec![a.clone(), b.clone(), gone] };

        // Everything is gone from where it was moved to.
        assert_eq!(plan(entry.clone(), on_disk(&[])), Plan::Refuse { error: NOT_FOUND, keep: None });
        // Every item still there has something at its original place: kept for another try.
        let all_blocked = [a.0.as_str(), a.1.as_str()];
        assert_eq!(
            plan(entry.clone(), on_disk(&all_blocked)),
            Plan::Refuse { error: NAME_TAKEN, keep: Some(Entry::Move { items: vec![a.clone()] }) }
        );
        // `a` can go back, `b` cannot; what is gone is left out.
        let before = [a.0.as_str(), b.0.as_str(), b.1.as_str()];
        let step = Step::Move { free: vec![a.clone()], blocked: vec![b.clone()] };
        assert_eq!(plan(entry.clone(), on_disk(&before)), Plan::Run(step.clone()));

        // `a` went back, `b` is still at the destination.
        let after = [a.1.as_str(), b.0.as_str(), b.1.as_str()];
        let (message, left) = settle(step.clone(), Ok(()), on_disk(&after));
        assert_eq!(message, Ok("移動を元に戻しました（戻せなかった項目があります）".to_string()));
        assert_eq!(left, Some(Entry::Move { items: vec![b.clone()] }));

        // Nothing was blocked and all went back.
        let all = Step::Move { free: vec![a.clone(), b.clone()], blocked: Vec::new() };
        let (message, left) = settle(all.clone(), Ok(()), on_disk(&[a.1.as_str(), b.1.as_str()]));
        assert_eq!(message, Ok("移動を元に戻しました".to_string()));
        assert_eq!(left, None);

        // The operation failed: the error, and whatever is still at the destination stays.
        let (message, left) = settle(all, Err("denied".into()), on_disk(&[a.0.as_str(), b.1.as_str()]));
        assert_eq!(message, Err("denied".to_string()));
        assert_eq!(left, Some(Entry::Move { items: vec![a] }));
    }

    #[test]
    fn created_items_are_recycled_while_they_are_there() {
        let paths = vec![r"C:\a\copy.txt".to_string(), r"C:\a\gone.txt".to_string()];
        let entry = Entry::Trash { paths, label: "コピー" };
        assert_eq!(plan(entry.clone(), on_disk(&[])), Plan::Refuse { error: NOT_FOUND, keep: None });
        let step = Step::Trash { paths: vec![r"C:\a\copy.txt".to_string()], label: "コピー" };
        assert_eq!(plan(entry, on_disk(&[r"C:\a\copy.txt"])), Plan::Run(step.clone()));

        let (message, left) = settle(step.clone(), Ok(()), on_disk(&[]));
        assert_eq!(message, Ok("コピーを元に戻しました".to_string()));
        assert_eq!(left, None);
        // Cancelled or failed: what is still there can be tried again.
        let (message, left) = settle(step, Err("操作が中止されました".into()), on_disk(&[r"C:\a\copy.txt"]));
        assert_eq!(message, Err("操作が中止されました".to_string()));
        assert_eq!(left, Some(Entry::Trash { paths: vec![r"C:\a\copy.txt".to_string()], label: "コピー" }));
    }

    #[test]
    fn restoring_reports_each_failure_and_keeps_what_is_still_in_the_bin() {
        let a = pair(r"C:\a\a.txt", r"C:\$Recycle.Bin\S-1\$RA.txt");
        let b = pair(r"C:\a\b.txt", r"C:\$Recycle.Bin\S-1\$RB.txt");
        let c = pair(r"C:\a\c.txt", r"C:\$Recycle.Bin\S-1\$RC.txt");
        let items = vec![a.clone(), b.clone(), c.clone()];
        // The plan leaves every item in: each is looked at when it is restored.
        assert_eq!(plan(Entry::Restore { items: items.clone() }, on_disk(&[])), Plan::Restore(items.clone()));

        let (message, left) = settle_restore(items.clone(), vec![Ok(()), Ok(()), Ok(())], on_disk(&[]));
        assert_eq!(message, Ok("削除を元に戻しました".to_string()));
        assert_eq!(left, None);

        // `b` is blocked and still in the bin; `c` failed and is no longer there.
        let results = vec![Ok(()), Err(NAME_TAKEN.to_string()), Err("gone".to_string())];
        let (message, left) = settle_restore(items, results, on_disk(&[b.1.as_str()]));
        assert_eq!(message, Err(format!("{}: {NAME_TAKEN}\n{}: gone", b.0, c.0)));
        assert_eq!(left, Some(Entry::Restore { items: vec![b] }));
    }
}
