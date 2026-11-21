//! File operations through IFileOperation, with undo history. Spec: docs/spec/fileops.md.
//! Everything runs on `crate::com::op_pool()` (one STA thread), so the undo history stays ordered.
//!
//! - `session`: one IFileOperation run and what its progress sink saw.
//! - `history`: the undo history, and undoing.
//! - `recycle_bin`: taking items back out of the Recycle Bin.
//! - `link`: creating shortcuts.

mod history;
mod link;
mod recycle_bin;
mod session;

use std::path::{Path, PathBuf};

use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL};
use windows::Win32::UI::Shell::{
    FILEOPERATION_FLAGS, FOF_ALLOWUNDO, FOF_RENAMEONCOLLISION, FOF_WANTNUKEWARNING, FOFX_RECYCLEONDELETE,
    IShellItemArray,
};
use windows::core::PCWSTR;

use crate::com::{self, Hwnd, err, shell_item, wide};
use crate::types::{FileOp, OpResult};
pub(crate) use history::undo_sync;
use history::{Entry, record};
use session::{Kind, NO_FLAGS, NO_SINK, Outcome, run_session};

/// Runs `op`. `owner` is the parent window of progress/confirm dialogs.
pub async fn execute(op: FileOp, owner: Hwnd) -> Result<OpResult, String> {
    com::op_pool().run(move || execute_sync(op, owner, false)).await?
}

/// Undoes the most recent recorded operation. Returns a short description of what was undone,
/// or `None` when the history is empty.
pub async fn undo(owner: Hwnd) -> Result<Option<String>, String> {
    com::op_pool().run(move || undo_sync(owner, false)).await?
}

/// Lower-cased names of the `sources` that already have an item of the same name in `dest`.
/// Copying or moving those replaces a file or merges into a folder, so what ends up there is not
/// ours to remove on undo (and what was replaced cannot be brought back).
fn names_taken(sources: &[String], dest: &str) -> Vec<String> {
    sources
        .iter()
        .filter_map(|s| Path::new(s).file_name())
        .filter(|name| Path::new(dest).join(name).exists())
        .map(|name| name.to_string_lossy().to_lowercase())
        .collect()
}

fn name_is_taken(path: &str, taken: &[String]) -> bool {
    Path::new(path)
        .file_name()
        .is_some_and(|n| taken.contains(&n.to_string_lossy().to_lowercase()))
}

fn paths_array(paths: &[String]) -> Result<IShellItemArray, String> {
    crate::dataobject::item_array(paths).map_err(|e| e.with_path("対象がありません"))
}

fn recycle_flags() -> FILEOPERATION_FLAGS {
    // FOF_WANTNUKEWARNING: ask before deleting for good what cannot go to the Recycle Bin.
    FOF_ALLOWUNDO | FOFX_RECYCLEONDELETE | FOF_WANTNUKEWARNING
}

fn recycle(paths: &[String], owner: Hwnd, silent: bool) -> Result<Outcome, String> {
    let arr = paths_array(paths)?;
    run_session(owner, recycle_flags(), silent, |op| unsafe { op.DeleteItems(&arr) })
}

// ---------------------------------------------------------------------------------------------
// execute

pub(crate) fn execute_sync(op: FileOp, owner: Hwnd, silent: bool) -> Result<OpResult, String> {
    let (mut result, entry) = match op {
        FileOp::Copy { sources, dest } => copy_move(&sources, &dest, false, owner, silent)?,
        FileOp::Move { sources, dest } => copy_move(&sources, &dest, true, owner, silent)?,
        FileOp::Link { sources, dest } => link::link(&sources, &dest)?,
        FileOp::Duplicate { sources } => duplicate(&sources, owner, silent)?,
        FileOp::Recycle { paths } => {
            let out = recycle(&paths, owner, silent)?;
            out.check()?;
            let items: Vec<(String, String)> = out
                .ok_events(Kind::Delete)
                .filter_map(|e| e.created.clone().map(|c| (e.source.clone(), c)))
                .collect();
            let entry = (!items.is_empty()).then_some(Entry::Restore { items });
            (out.result(Vec::new()), entry)
        }
        FileOp::Delete { paths } => {
            let arr = paths_array(&paths)?;
            let out = run_session(owner, NO_FLAGS, silent, |op| unsafe { op.DeleteItems(&arr) })?;
            out.check()?;
            (out.result(Vec::new()), None)
        }
        FileOp::Rename { path, new_name } => rename(&path, &new_name, owner, silent)?,
        FileOp::NewFolder { parent, name } => new_item(&parent, &name, true, owner, silent)?,
        FileOp::NewFile { parent, name } => new_item(&parent, &name, false, owner, silent)?,
    };
    if let Some(entry) = entry {
        record(entry);
        result.undoable = true;
    }
    Ok(result)
}

type Done = (OpResult, Option<Entry>);

fn copy_move(sources: &[String], dest: &str, mv: bool, owner: Hwnd, silent: bool) -> Result<Done, String> {
    let arr = paths_array(sources)?;
    let dest_item = shell_item(dest).map_err(err)?;
    let taken = names_taken(sources, dest);
    let out = run_session(owner, NO_FLAGS, silent, |op| unsafe {
        if mv {
            op.MoveItems(&arr, &dest_item)
        } else {
            op.CopyItems(&arr, &dest_item)
        }
    })?;
    out.check()?;
    let kind = if mv { Kind::Move } else { Kind::Copy };
    let pairs: Vec<(String, String)> = out
        .ok_events(kind)
        .filter_map(|e| e.created.clone().map(|c| (c, e.source.clone())))
        .collect();
    let sorted = sort_copied(pairs, &taken, mv);
    let mut result = out.result(sorted.created);
    result.replaced = sorted.replaced;
    Ok((result, sorted.entry))
}

/// What a finished copy or move reports and records.
#[derive(Debug, PartialEq)]
struct Copied {
    /// Everything that is at the destination now.
    created: Vec<String>,
    /// Some items met one of the same name.
    replaced: bool,
    /// What undo may take back.
    entry: Option<Entry>,
}

/// Sorts the `(created, source)` pairs of a copy (or a move, `mv`) by whether the name was
/// `taken` at the destination before the operation.
fn sort_copied(pairs: Vec<(String, String)>, taken: &[String], mv: bool) -> Copied {
    let created: Vec<String> = pairs.iter().map(|(c, _)| c.clone()).collect();
    // Items that met one of the same name (replaced, merged or skipped) stay out of the history:
    // Windows reports them like any other, and undoing would take away what was there before.
    let (kept, ours): (Vec<_>, Vec<_>) = pairs.into_iter().partition(|(c, _)| name_is_taken(c, taken));
    let entry = if ours.is_empty() {
        None
    } else if mv {
        Some(Entry::Move { items: ours })
    } else {
        Some(Entry::Trash {
            paths: ours.into_iter().map(|(c, _)| c).collect(),
            label: "コピー",
        })
    };
    Copied {
        created,
        replaced: !kept.is_empty(),
        entry,
    }
}

fn duplicate(sources: &[String], owner: Hwnd, silent: bool) -> Result<Done, String> {
    if sources.is_empty() {
        return Err("対象がありません".into());
    }
    let out = run_session(owner, FOF_RENAMEONCOLLISION, silent, |op| unsafe {
        for s in sources {
            let parent = Path::new(s)
                .parent()
                .and_then(|p| p.to_str())
                .ok_or_else(|| windows::core::Error::from(windows::Win32::Foundation::E_INVALIDARG))?;
            let item = shell_item(s)?;
            let parent_item = shell_item(parent)?;
            op.CopyItem(&item, &parent_item, PCWSTR::null(), NO_SINK)?;
        }
        Ok(())
    })?;
    out.check()?;
    let created: Vec<String> = out.ok_events(Kind::Copy).filter_map(|e| e.created.clone()).collect();
    let entry = (!created.is_empty()).then(|| Entry::Trash {
        paths: created.clone(),
        label: "複製",
    });
    Ok((out.result(created), entry))
}

fn rename(path: &str, new_name: &str, owner: Hwnd, silent: bool) -> Result<Done, String> {
    let old_name = Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| "名前を変更できません".to_string())?;
    if old_name == new_name {
        return Ok((
            OpResult {
                created: vec![path.to_string()],
                ..Default::default()
            },
            None,
        ));
    }
    let out = rename_raw(path, new_name, owner, silent)?;
    out.check()?;
    let created: Vec<String> = out.ok_events(Kind::Rename).filter_map(|e| e.created.clone()).collect();
    let entry = created.first().map(|c| Entry::Rename {
        current: c.clone(),
        old_name,
    });
    Ok((out.result(created), entry))
}

fn rename_raw(path: &str, new_name: &str, owner: Hwnd, silent: bool) -> Result<Outcome, String> {
    let item = shell_item(path).map_err(err)?;
    let nw = wide(new_name);
    run_session(owner, NO_FLAGS, silent, |op| unsafe {
        op.RenameItem(&item, PCWSTR(nw.as_ptr()), NO_SINK)
    })
}

fn new_item(parent: &str, name: &str, folder: bool, owner: Hwnd, silent: bool) -> Result<Done, String> {
    let exists = Path::new(parent).join(name).exists();
    let flags = if exists { FOF_RENAMEONCOLLISION } else { NO_FLAGS };
    let parent_item = shell_item(parent).map_err(err)?;
    let nw = wide(name);
    let attr = if folder {
        FILE_ATTRIBUTE_DIRECTORY.0
    } else {
        FILE_ATTRIBUTE_NORMAL.0
    };
    let out = run_session(owner, flags, silent, |op| unsafe {
        op.NewItem(&parent_item, attr, PCWSTR(nw.as_ptr()), PCWSTR::null(), NO_SINK)
    })?;
    out.check()?;
    let mut created: Vec<String> = out.ok_events(Kind::New).filter_map(|e| e.created.clone()).collect();
    if created.is_empty() && out.any_ok() {
        created.push(PathBuf::from(parent).join(name).to_string_lossy().into_owned());
    }
    let label = if folder {
        "フォルダーの作成"
    } else {
        "ファイルの作成"
    };
    let entry = (!created.is_empty()).then(|| Entry::Trash {
        paths: created.clone(),
        label,
    });
    Ok((out.result(created), entry))
}

// ---------------------------------------------------------------------------------------------
// tests

#[cfg(test)]
mod sort_copied_tests {
    use super::*;

    fn pair(a: &str, b: &str) -> (String, String) {
        (a.to_string(), b.to_string())
    }

    #[test]
    fn items_that_met_the_same_name_stay_out_of_the_history() {
        let a = pair(r"C:\dst\a.txt", r"C:\src\a.txt");
        let b = pair(r"C:\dst\B.txt", r"C:\src\b.txt");
        let taken = vec!["b.txt".to_string()];
        let both = vec![a.0.clone(), b.0.clone()];

        let copied = sort_copied(vec![a.clone(), b.clone()], &taken, false);
        assert_eq!(copied.created, both);
        assert!(copied.replaced);
        assert_eq!(
            copied.entry,
            Some(Entry::Trash {
                paths: vec![a.0.clone()],
                label: "コピー"
            })
        );

        let moved = sort_copied(vec![a.clone(), b.clone()], &taken, true);
        assert_eq!(moved.created, both);
        assert!(moved.replaced);
        assert_eq!(moved.entry, Some(Entry::Move { items: vec![a.clone()] }));

        // Nothing met a name: everything can be undone.
        let free = sort_copied(vec![a.clone(), b.clone()], &[], true);
        assert!(!free.replaced);
        assert_eq!(
            free.entry,
            Some(Entry::Move {
                items: vec![a, b.clone()]
            })
        );

        // Everything met a name: reported, but nothing to undo.
        let all = sort_copied(vec![b.clone()], &taken, false);
        assert_eq!(
            all,
            Copied {
                created: vec![b.0],
                replaced: true,
                entry: None
            }
        );
        assert_eq!(
            sort_copied(Vec::new(), &taken, false),
            Copied {
                created: Vec::new(),
                replaced: false,
                entry: None
            }
        );
    }

    #[test]
    fn a_name_is_taken_whatever_its_case_and_folder() {
        let taken = vec!["写真.jpg".to_string(), "dir".to_string()];
        assert!(name_is_taken(r"D:\x\写真.JPG", &taken));
        assert!(name_is_taken(r"D:\x\Dir", &taken));
        assert!(!name_is_taken(r"D:\dir\other.txt", &taken));
        assert!(!name_is_taken(r"D:\x\dir2", &taken));
    }
}

#[cfg(test)]
mod tests {
    use super::history::{NAME_TAKEN, NOT_FOUND};
    use super::*;
    use std::fs;

    fn history_len() -> usize {
        com::lock(history::history()).len()
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    /// Runs `f` as one job on the op thread so history stays consistent between steps.
    fn on_op<F: FnOnce() + Send + 'static>(f: F) {
        com::op_pool().run_blocking(f).unwrap();
    }

    fn exec(op: FileOp) -> OpResult {
        execute_sync(op, Hwnd::NONE, true).unwrap()
    }

    fn undo_it() -> String {
        undo_sync(Hwnd::NONE, true).unwrap().expect("history entry")
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn copy_then_undo() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(&dst).unwrap();
        fs::write(src.join("a.txt"), "hello").unwrap();
        let (a, d) = (s(&src.join("a.txt")), s(&dst));
        on_op(move || {
            let r = exec(FileOp::Copy {
                sources: vec![a],
                dest: d,
            });
            assert!(r.undoable);
            assert_eq!(r.created.len(), 1);
            assert!(r.created[0].ends_with("a.txt"));
            assert_eq!(fs::read_to_string(dst.join("a.txt")).unwrap(), "hello");
            assert!(undo_it().contains("コピー"));
            assert!(!dst.join("a.txt").exists());
            assert!(src.join("a.txt").exists());
        });
    }

    #[test]
    fn move_then_undo() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(&dst).unwrap();
        fs::write(src.join("m.txt"), "move").unwrap();
        let (a, d) = (s(&src.join("m.txt")), s(&dst));
        on_op(move || {
            let r = exec(FileOp::Move {
                sources: vec![a],
                dest: d,
            });
            assert!(r.undoable);
            assert!(!src.join("m.txt").exists());
            assert!(dst.join("m.txt").exists());
            assert!(undo_it().contains("移動"));
            assert!(src.join("m.txt").exists());
            assert!(!dst.join("m.txt").exists());
        });
    }

    #[test]
    fn rename_then_undo() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("old.txt"), "r").unwrap();
        let p = s(&tmp.path().join("old.txt"));
        let dir = tmp.path().to_path_buf();
        on_op(move || {
            let r = exec(FileOp::Rename {
                path: p,
                new_name: "new.txt".into(),
            });
            assert!(r.undoable);
            assert_eq!(r.created.len(), 1);
            assert!(dir.join("new.txt").exists() && !dir.join("old.txt").exists());
            assert!(undo_it().contains("名前の変更"));
            assert!(dir.join("old.txt").exists() && !dir.join("new.txt").exists());
        });
    }

    #[test]
    fn new_folder_and_file_with_collision_then_undo() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let parent = s(&dir);
        on_op(move || {
            let r1 = exec(FileOp::NewFolder {
                parent: parent.clone(),
                name: "newdir".into(),
            });
            assert!(dir.join("newdir").is_dir());
            assert_eq!(r1.created.len(), 1);
            let r2 = exec(FileOp::NewFolder {
                parent: parent.clone(),
                name: "newdir".into(),
            });
            assert_eq!(r2.created.len(), 1);
            assert_ne!(r2.created[0], r1.created[0]);
            assert!(Path::new(&r2.created[0]).is_dir());

            let f1 = exec(FileOp::NewFile {
                parent: parent.clone(),
                name: "n.txt".into(),
            });
            assert!(dir.join("n.txt").is_file());
            let f2 = exec(FileOp::NewFile {
                parent: parent.clone(),
                name: "n.txt".into(),
            });
            assert_ne!(f1.created[0], f2.created[0]);
            assert!(Path::new(&f2.created[0]).is_file());

            for _ in 0..4 {
                undo_it();
            }
            assert!(names(&dir).is_empty(), "left: {:?}", names(&dir));
        });
    }

    #[test]
    fn duplicate_gets_new_name() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("d.txt"), "dup").unwrap();
        let p = s(&tmp.path().join("d.txt"));
        let dir = tmp.path().to_path_buf();
        on_op(move || {
            let r = exec(FileOp::Duplicate { sources: vec![p] });
            assert_eq!(r.created.len(), 1);
            let created = PathBuf::from(&r.created[0]);
            assert_ne!(created.file_name().unwrap(), "d.txt");
            assert_eq!(fs::read_to_string(&created).unwrap(), "dup");
            assert_eq!(names(&dir).len(), 2);
            undo_it();
            assert_eq!(names(&dir), vec!["d.txt".to_string()]);
        });
    }

    #[test]
    fn link_creates_lnk_and_undo_removes_it() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("t.txt"), "t").unwrap();
        let dest = tmp.path().join("links");
        fs::create_dir_all(&dest).unwrap();
        let (p, d) = (s(&tmp.path().join("t.txt")), s(&dest));
        on_op(move || {
            let r = exec(FileOp::Link {
                sources: vec![p.clone()],
                dest: d.clone(),
            });
            assert_eq!(r.created.len(), 1);
            let first = PathBuf::from(&r.created[0]);
            let name = first.file_name().unwrap().to_string_lossy().into_owned();
            assert_eq!(name, "t.txt - ショートカット.lnk");
            assert!(first.is_file());
            let r2 = exec(FileOp::Link {
                sources: vec![p],
                dest: d,
            });
            assert!(r2.created[0].ends_with("t.txt - ショートカット (2).lnk"));
            undo_it();
            undo_it();
            assert!(names(&dest).is_empty());
        });
    }

    #[test]
    fn recycle_then_undo_restores_same_path() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("vesta-recycle-test.txt");
        fs::write(&file, "keep me").unwrap();
        let p = s(&file);
        on_op(move || {
            let r = exec(FileOp::Recycle { paths: vec![p] });
            assert!(r.undoable, "recycle was not recorded: {r:?}");
            assert!(!file.exists());
            assert!(undo_it().contains("削除"));
            assert_eq!(fs::read_to_string(&file).unwrap(), "keep me");
        });
    }

    #[test]
    fn recycle_of_several_items_then_undo_restores_them_all() {
        let tmp = tempfile::tempdir().unwrap();
        let files: Vec<PathBuf> = ["vesta-multi-1.txt", "vesta-multi-2.txt", "vesta-multi-3.txt"]
            .iter()
            .map(|n| tmp.path().join(n))
            .collect();
        for (i, f) in files.iter().enumerate() {
            fs::write(f, format!("keep {i}")).unwrap();
        }
        let paths: Vec<String> = files.iter().map(|f| s(f)).collect();
        on_op(move || {
            let r = exec(FileOp::Recycle { paths });
            assert!(r.undoable);
            assert!(files.iter().all(|f| !f.exists()));
            assert!(undo_it().contains("削除"));
            for (i, f) in files.iter().enumerate() {
                assert_eq!(fs::read_to_string(f).unwrap(), format!("keep {i}"));
            }
        });
    }

    #[test]
    fn permanent_delete_is_not_recorded() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("gone.txt");
        fs::write(&file, "x").unwrap();
        let p = s(&file);
        on_op(move || {
            let before = history_len();
            let r = exec(FileOp::Delete { paths: vec![p] });
            assert!(!r.undoable);
            assert!(!file.exists());
            assert_eq!(history_len(), before);
        });
    }

    /// `src` and `dst` folders in a new temporary folder.
    fn two_dirs() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let (src, dst) = (tmp.path().join("src"), tmp.path().join("dst"));
        fs::create_dir_all(&src).unwrap();
        fs::create_dir_all(&dst).unwrap();
        (tmp, src, dst)
    }

    #[test]
    fn copy_over_the_same_name_is_left_out_of_undo() {
        let (_tmp, src, dst) = two_dirs();
        fs::write(src.join("a.txt"), "new").unwrap();
        fs::write(src.join("b.txt"), "new").unwrap();
        fs::write(dst.join("a.txt"), "old").unwrap();
        let sources = vec![s(&src.join("a.txt")), s(&src.join("b.txt"))];
        let d = s(&dst);
        on_op(move || {
            let r = exec(FileOp::Copy { sources, dest: d });
            assert!(r.replaced && r.undoable && r.done);
            assert_eq!(r.created.len(), 2);
            undo_it();
            // Only the copy that met nothing goes away; the replaced file is not ours to remove.
            assert_eq!(names(&dst), vec!["a.txt".to_string()]);
        });
    }

    #[test]
    fn copy_merged_into_a_folder_is_left_out_of_undo() {
        let (_tmp, src, dst) = two_dirs();
        fs::create_dir_all(src.join("dir")).unwrap();
        fs::create_dir_all(dst.join("dir")).unwrap();
        fs::write(src.join("dir").join("from-src.txt"), "new").unwrap();
        fs::write(dst.join("dir").join("was-here.txt"), "old").unwrap();
        let (a, d) = (s(&src.join("dir")), s(&dst));
        on_op(move || {
            let before = history_len();
            let r = exec(FileOp::Copy {
                sources: vec![a],
                dest: d,
            });
            assert!(r.replaced && !r.undoable);
            assert_eq!(history_len(), before);
            assert!(dst.join("dir").join("from-src.txt").exists());
            assert!(dst.join("dir").join("was-here.txt").exists());
        });
    }

    #[test]
    fn folders_copy_and_move_then_undo() {
        let (_tmp, src, dst) = two_dirs();
        fs::create_dir_all(src.join("dir").join("sub")).unwrap();
        fs::write(src.join("dir").join("in.txt"), "1").unwrap();
        fs::write(src.join("dir").join("sub").join("deep.txt"), "2").unwrap();
        let (a, d) = (s(&src.join("dir")), s(&dst));
        on_op(move || {
            let r = exec(FileOp::Copy {
                sources: vec![a.clone()],
                dest: d.clone(),
            });
            assert_eq!(r.created.len(), 1, "only the folder itself: {:?}", r.created);
            assert!(dst.join("dir").join("sub").join("deep.txt").exists());
            undo_it();
            assert!(names(&dst).is_empty());

            let r = exec(FileOp::Move {
                sources: vec![a],
                dest: d,
            });
            assert_eq!(r.created.len(), 1);
            assert!(!src.join("dir").exists());
            undo_it();
            assert!(names(&dst).is_empty());
            assert_eq!(
                fs::read_to_string(src.join("dir").join("sub").join("deep.txt")).unwrap(),
                "2"
            );
        });
    }

    #[test]
    fn undo_of_a_move_does_not_replace_and_can_be_tried_again() {
        let (_tmp, src, dst) = two_dirs();
        fs::write(src.join("m.txt"), "moved").unwrap();
        let (a, d) = (s(&src.join("m.txt")), s(&dst));
        on_op(move || {
            exec(FileOp::Move {
                sources: vec![a],
                dest: d,
            });
            fs::write(src.join("m.txt"), "newer").unwrap();
            assert_eq!(undo_sync(Hwnd::NONE, true), Err(NAME_TAKEN.to_string()));
            assert_eq!(fs::read_to_string(src.join("m.txt")).unwrap(), "newer");
            assert!(dst.join("m.txt").exists());
            // The entry is still in the history: the same undo works once the place is free.
            fs::remove_file(src.join("m.txt")).unwrap();
            assert!(undo_it().contains("移動"));
            assert_eq!(fs::read_to_string(src.join("m.txt")).unwrap(), "moved");
        });
    }

    #[test]
    fn undo_of_a_delete_does_not_replace_and_can_be_tried_again() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("vesta-undelete-test.txt");
        fs::write(&file, "deleted").unwrap();
        let p = s(&file);
        on_op(move || {
            exec(FileOp::Recycle { paths: vec![p] });
            fs::write(&file, "newer").unwrap();
            let e = undo_sync(Hwnd::NONE, true).unwrap_err();
            assert!(e.contains(NAME_TAKEN), "{e}");
            assert_eq!(fs::read_to_string(&file).unwrap(), "newer");
            fs::remove_file(&file).unwrap();
            assert!(undo_it().contains("削除"));
            assert_eq!(fs::read_to_string(&file).unwrap(), "deleted");
        });
    }

    #[test]
    fn undo_of_items_that_are_gone_is_dropped() {
        let (_tmp, src, dst) = two_dirs();
        fs::write(src.join("g.txt"), "x").unwrap();
        let (a, d) = (s(&src.join("g.txt")), s(&dst));
        on_op(move || {
            exec(FileOp::Copy {
                sources: vec![a],
                dest: d,
            });
            fs::remove_file(dst.join("g.txt")).unwrap();
            let before = history_len();
            assert_eq!(undo_sync(Hwnd::NONE, true), Err(NOT_FOUND.to_string()));
            assert_eq!(history_len(), before - 1);
        });
    }

    #[test]
    fn names_in_other_scripts_survive_every_operation() {
        let (_tmp, src, dst) = two_dirs();
        // Kanji, an emoji outside the BMP, a combining mark, a full-width space.
        let folder = src.join("日本語 フォルダ 😀");
        let name = "か\u{3099}き🎉\u{3000}全角 空白.txt";
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join(name), "中身").unwrap();
        let (f, d) = (s(&folder), s(&dst));
        on_op(move || {
            let listed = crate::listing::list(&f, false).unwrap();
            let entry = listed
                .entries
                .iter()
                .find(|e| e.name == name)
                .expect("listed with the same name");
            assert!(Path::new(&entry.location).exists());

            let r = exec(FileOp::Copy {
                sources: vec![f.clone()],
                dest: d.clone(),
            });
            let copied = PathBuf::from(&r.created[0]);
            assert_eq!(copied.file_name().unwrap().to_string_lossy(), "日本語 フォルダ 😀");
            assert_eq!(fs::read_to_string(copied.join(name)).unwrap(), "中身");

            let r = exec(FileOp::Rename {
                path: s(&copied.join(name)),
                new_name: "新しい名前🍣.txt".into(),
            });
            assert!(r.created[0].ends_with("新しい名前🍣.txt"));
            assert!(copied.join("新しい名前🍣.txt").exists());

            let r = exec(FileOp::Recycle {
                paths: vec![s(&copied.join("新しい名前🍣.txt"))],
            });
            assert!(r.undoable);
            assert!(undo_it().contains("削除"));
            assert!(copied.join("新しい名前🍣.txt").exists());
            assert!(undo_it().contains("名前の変更"));
            assert!(copied.join(name).exists());
            assert!(undo_it().contains("コピー"));
            assert!(names(&dst).is_empty());
        });
    }

    /// What works in a folder whose path is longer than 260 characters: run with
    /// `--ignored --nocapture` and read the output (README「既知の制限」).
    #[test]
    #[ignore]
    fn long_paths_probe() {
        let (_tmp, src, dst) = two_dirs();
        let mut deep = dst.clone();
        while s(&deep).encode_utf16().count() < 300 {
            deep = deep.join("とても長い名前のフォルダ-0123456789-0123456789");
        }
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("inside.txt"), "x").unwrap();
        fs::write(src.join("a.txt"), "x").unwrap();
        let (a, d) = (s(&src.join("a.txt")), s(&deep));
        println!("path length: {}", d.encode_utf16().count());
        on_op(move || {
            println!("list: {:?}", crate::listing::list(&d, false).map(|l| l.entries.len()));
            println!(
                "copy in: {:?}",
                execute_sync(
                    FileOp::Copy {
                        sources: vec![a],
                        dest: d.clone()
                    },
                    Hwnd::NONE,
                    true
                )
            );
            let inside = format!("{d}\\inside.txt");
            println!(
                "rename: {:?}",
                execute_sync(
                    FileOp::Rename {
                        path: inside.clone(),
                        new_name: "renamed.txt".into()
                    },
                    Hwnd::NONE,
                    true
                )
            );
            let renamed = format!("{d}\\renamed.txt");
            println!(
                "recycle: {:?}",
                execute_sync(FileOp::Recycle { paths: vec![renamed] }, Hwnd::NONE, true)
            );
            println!("undo: {:?}", undo_sync(Hwnd::NONE, true));
            println!(
                "new folder: {:?}",
                execute_sync(
                    FileOp::NewFolder {
                        parent: d,
                        name: "n".into()
                    },
                    Hwnd::NONE,
                    true
                )
            );
        });
    }

    #[test]
    fn undo_on_empty_history_is_none() {
        on_op(|| {
            while undo_sync(Hwnd::NONE, true).map(|r| r.is_some()).unwrap_or(true) {}
            assert_eq!(undo_sync(Hwnd::NONE, true).unwrap(), None);
        });
    }
}
