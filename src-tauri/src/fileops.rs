//! File operations through IFileOperation, with undo history. Spec: docs/spec/fileops.md.
//! Everything runs on `crate::com::op_pool()` (one STA thread), so the undo history stays ordered.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use windows::Win32::Foundation::HWND;
use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL};
use windows::Win32::System::Com::{
    CLSCTX_ALL, CLSCTX_INPROC_SERVER, CoCreateInstance, IBindCtx, IPersistFile,
};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    BHID_EnumItems, CMF_NORMAL, COPYENGINE_S_USER_IGNORED, IEnumShellItems, CMINVOKECOMMANDINFO,
    FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOCONFIRMMKDIR, FOF_NOERRORUI, FOF_RENAMEONCOLLISION,
    FOF_SILENT, FOF_WANTNUKEWARNING, FOFX_RECYCLEONDELETE,
    FILEOPERATION_FLAGS, FileOperation, IContextMenu, IFileOperation, IFileOperationProgressSink,
    IFileOperationProgressSink_Impl, IShellItem, GCS_VERBW, IShellFolder, IShellItemArray, IShellLinkW, SHBindToParent,
    SHCreateShellItemArrayFromIDLists, SHGetIDListFromObject, ShellLink, SIGDN_FILESYSPATH,
};
use windows::Win32::UI::WindowsAndMessaging::{CreatePopupMenu, DestroyMenu, SW_SHOWNORMAL};
use windows::core::{HRESULT, Interface, PCSTR, PCWSTR, PSTR, Ref, implement};

use crate::com::{self, Pidl, err, item_name, parsing_name, shell_item, wide};
use crate::types::{FileOp, OpResult};

const HISTORY_MAX: usize = 50;
const CMIC_MASK_NOASYNC: u32 = 0x100;
const CMIC_MASK_FLAG_NO_UI: u32 = 0x400;
/// HRESULT_FROM_WIN32(ERROR_CANCELLED)
const E_CANCELLED: i32 = 0x800704C7u32 as i32;

/// Runs `op`. `owner` is the HWND (as isize) used as the parent of progress/confirm dialogs.
pub async fn execute(op: FileOp, owner: isize) -> Result<OpResult, String> {
    com::op_pool().run(move || execute_sync(op, owner, false)).await?
}

/// Undoes the most recent recorded operation. Returns a short description of what was undone,
/// or `None` when the history is empty.
pub async fn undo(owner: isize) -> Result<Option<String>, String> {
    com::op_pool().run(move || undo_sync(owner, false)).await?
}

// ---------------------------------------------------------------------------------------------
// Undo history

enum Entry {
    /// `current` is the path after renaming.
    Rename { current: String, old_name: String },
    /// `(current, original)` path pairs.
    Move { items: Vec<(String, String)> },
    /// Created items; undo sends them to the Recycle Bin.
    Trash { paths: Vec<String>, label: &'static str },
    /// `(original path, `$R...` path of the item in the Recycle Bin)`.
    Restore { items: Vec<(String, String)> },
}

fn history() -> &'static Mutex<VecDeque<Entry>> {
    static H: Mutex<VecDeque<Entry>> = Mutex::new(VecDeque::new());
    &H
}

fn record(entry: Entry) {
    let mut h = history().lock().unwrap_or_else(|e| e.into_inner());
    h.push_back(entry);
    while h.len() > HISTORY_MAX {
        h.pop_front();
    }
}

// ---------------------------------------------------------------------------------------------
// Progress sink

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Copy,
    Move,
    Rename,
    New,
    Delete,
}

struct Event {
    kind: Kind,
    /// Parsing name of the source item (empty for NewItem).
    source: String,
    /// Parsing name of the newly created item.
    created: Option<String>,
    hr: HRESULT,
}

impl Event {
    /// The item was really processed: success, and not one the user chose to skip.
    fn done(&self) -> bool {
        self.hr.is_ok() && self.hr != COPYENGINE_S_USER_IGNORED
    }
}

/// `path` is somewhere below the folder `folder` (not the folder itself). Empty paths never match.
fn is_inside(path: &str, folder: &str) -> bool {
    let folder = folder.trim_end_matches('\\');
    !folder.is_empty()
        && path.get(..folder.len()).is_some_and(|head| head.eq_ignore_ascii_case(folder))
        && path[folder.len()..].starts_with('\\')
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
        if let Ok(mut v) = self.events.lock() {
            v.push(Event { kind, source, created, hr });
        }
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

struct Outcome {
    events: Vec<Event>,
    aborted: bool,
    perform_err: Option<String>,
}

impl Outcome {
    /// Events of the items the operation was asked for. The sink also reports every item inside
    /// a folder; those are left out (undoing the folder takes them along).
    fn ok_events(&self, kind: Kind) -> impl Iterator<Item = &Event> {
        let done: Vec<&Event> = self.events.iter().filter(|e| e.kind == kind && e.done()).collect();
        let sources: Vec<&str> = done.iter().map(|e| e.source.as_str()).collect();
        done.into_iter().filter(move |e| !sources.iter().any(|s| is_inside(&e.source, s)))
    }

    fn any_ok(&self) -> bool {
        self.events.iter().any(Event::done)
    }

    fn result(&self, created: Vec<String>) -> OpResult {
        OpResult { created, aborted: self.aborted, done: self.any_ok(), ..Default::default() }
    }

    /// Error when the operation failed for every item (cancelling is not an error).
    fn check(&self) -> Result<(), String> {
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
    fn require_some(&self) -> Result<(), String> {
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
fn run_session<F>(
    owner: isize,
    flags: FILEOPERATION_FLAGS,
    silent: bool,
    f: F,
) -> Result<Outcome, String>
where
    F: FnOnce(&IFileOperation) -> windows::core::Result<()>,
{
    unsafe {
        let op: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL).map_err(err)?;
        if owner != 0 {
            op.SetOwnerWindow(HWND(owner as _)).map_err(err)?;
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

        let events = std::mem::take(&mut *events.lock().unwrap_or_else(|e| e.into_inner()));
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

fn paths_array(paths: &[String]) -> Result<(Vec<Pidl>, IShellItemArray), String> {
    if paths.is_empty() {
        return Err("対象がありません".into());
    }
    let pidls = paths
        .iter()
        .map(|p| Pidl::from_parsing(p).map_err(|e| format!("{p}: {}", err(e))))
        .collect::<Result<Vec<_>, _>>()?;
    let ptrs: Vec<_> = pidls.iter().map(|p| p.as_ptr()).collect();
    let arr = unsafe { SHCreateShellItemArrayFromIDLists(&ptrs) }.map_err(err)?;
    Ok((pidls, arr))
}

const NO_FLAGS: FILEOPERATION_FLAGS = FILEOPERATION_FLAGS(0);
const NO_SINK: Option<&IFileOperationProgressSink> = None;

fn recycle_flags() -> FILEOPERATION_FLAGS {
    // FOF_WANTNUKEWARNING: ask before deleting for good what cannot go to the Recycle Bin.
    FOF_ALLOWUNDO | FOFX_RECYCLEONDELETE | FOF_WANTNUKEWARNING
}

fn recycle(paths: &[String], owner: isize, silent: bool) -> Result<Outcome, String> {
    let (_keep, arr) = paths_array(paths)?;
    run_session(owner, recycle_flags(), silent, |op| unsafe { op.DeleteItems(&arr) })
}

// ---------------------------------------------------------------------------------------------
// execute

pub(crate) fn execute_sync(op: FileOp, owner: isize, silent: bool) -> Result<OpResult, String> {
    let (mut result, entry) = match op {
        FileOp::Copy { sources, dest } => copy_move(&sources, &dest, false, owner, silent)?,
        FileOp::Move { sources, dest } => copy_move(&sources, &dest, true, owner, silent)?,
        FileOp::Link { sources, dest } => link(&sources, &dest)?,
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
            let (_keep, arr) = paths_array(&paths)?;
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

fn copy_move(
    sources: &[String],
    dest: &str,
    mv: bool,
    owner: isize,
    silent: bool,
) -> Result<Done, String> {
    let (_keep, arr) = paths_array(sources)?;
    let dest_item = shell_item(dest).map_err(err)?;
    let taken = names_taken(sources, dest);
    let out = run_session(owner, NO_FLAGS, silent, |op| unsafe {
        if mv { op.MoveItems(&arr, &dest_item) } else { op.CopyItems(&arr, &dest_item) }
    })?;
    out.check()?;
    let kind = if mv { Kind::Move } else { Kind::Copy };
    let pairs: Vec<(String, String)> = out
        .ok_events(kind)
        .filter_map(|e| e.created.clone().map(|c| (c, e.source.clone())))
        .collect();
    let created: Vec<String> = pairs.iter().map(|(c, _)| c.clone()).collect();
    // Items that met one of the same name (replaced, merged or skipped) stay out of the history:
    // Windows reports them like any other, and undoing would take away what was there before.
    let (kept, ours): (Vec<_>, Vec<_>) = pairs.into_iter().partition(|(c, _)| name_is_taken(c, &taken));
    let entry = if ours.is_empty() {
        None
    } else if mv {
        Some(Entry::Move { items: ours })
    } else {
        Some(Entry::Trash { paths: ours.into_iter().map(|(c, _)| c).collect(), label: "コピー" })
    };
    let mut result = out.result(created);
    result.replaced = !kept.is_empty();
    Ok((result, entry))
}

fn duplicate(sources: &[String], owner: isize, silent: bool) -> Result<Done, String> {
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
    let entry = (!created.is_empty()).then(|| Entry::Trash { paths: created.clone(), label: "複製" });
    Ok((out.result(created), entry))
}

fn link(sources: &[String], dest: &str) -> Result<Done, String> {
    let mut created = Vec::new();
    let mut errors = Vec::new();
    for s in sources {
        match make_link(s, Path::new(dest)) {
            Ok(p) => created.push(p),
            Err(e) => errors.push(format!("{s}: {e}")),
        }
    }
    if created.is_empty() {
        return Err(if errors.is_empty() { "対象がありません".into() } else { errors.join("\n") });
    }
    let entry = Entry::Trash { paths: created.clone(), label: "ショートカットの作成" };
    let aborted = !errors.is_empty();
    Ok((OpResult { created, aborted, done: true, ..Default::default() }, Some(entry)))
}

fn make_link(source: &str, dest_dir: &Path) -> Result<String, String> {
    unsafe {
        let item = shell_item(source).map_err(err)?;
        let target = parsing_name(&item).map_err(err)?;
        let fname = Path::new(&target)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| com::display_name(&item).unwrap_or_else(|_| "link".into()));
        let base = format!("{fname} - ショートカット");
        let mut path = dest_dir.join(format!("{base}.lnk"));
        let mut n = 2;
        while path.exists() {
            path = dest_dir.join(format!("{base} ({n}).lnk"));
            n += 1;
        }
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(err)?;
        let tw = wide(&target);
        link.SetPath(PCWSTR(tw.as_ptr())).map_err(err)?;
        if let Some(dir) = Path::new(&target).parent().and_then(|d| d.to_str()) {
            let dw = wide(dir);
            let _ = link.SetWorkingDirectory(PCWSTR(dw.as_ptr()));
        }
        let file: IPersistFile = link.cast().map_err(err)?;
        let pw = wide(&path.to_string_lossy());
        file.Save(PCWSTR(pw.as_ptr()), true).map_err(err)?;
        Ok(path.to_string_lossy().into_owned())
    }
}

fn rename(path: &str, new_name: &str, owner: isize, silent: bool) -> Result<Done, String> {
    let old_name = Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| "名前を変更できません".to_string())?;
    if old_name == new_name {
        return Ok((OpResult { created: vec![path.to_string()], ..Default::default() }, None));
    }
    let out = rename_raw(path, new_name, owner, silent)?;
    out.check()?;
    let created: Vec<String> = out.ok_events(Kind::Rename).filter_map(|e| e.created.clone()).collect();
    let entry = created.first().map(|c| Entry::Rename { current: c.clone(), old_name });
    Ok((out.result(created), entry))
}

fn rename_raw(path: &str, new_name: &str, owner: isize, silent: bool) -> Result<Outcome, String> {
    let item = shell_item(path).map_err(err)?;
    let nw = wide(new_name);
    run_session(owner, NO_FLAGS, silent, |op| unsafe {
        op.RenameItem(&item, PCWSTR(nw.as_ptr()), NO_SINK)
    })
}

fn new_item(
    parent: &str,
    name: &str,
    folder: bool,
    owner: isize,
    silent: bool,
) -> Result<Done, String> {
    let exists = Path::new(parent).join(name).exists();
    let flags = if exists { FOF_RENAMEONCOLLISION } else { NO_FLAGS };
    let parent_item = shell_item(parent).map_err(err)?;
    let nw = wide(name);
    let attr = if folder { FILE_ATTRIBUTE_DIRECTORY.0 } else { FILE_ATTRIBUTE_NORMAL.0 };
    let out = run_session(owner, flags, silent, |op| unsafe {
        op.NewItem(&parent_item, attr, PCWSTR(nw.as_ptr()), PCWSTR::null(), NO_SINK)
    })?;
    out.check()?;
    let mut created: Vec<String> = out.ok_events(Kind::New).filter_map(|e| e.created.clone()).collect();
    if created.is_empty() && out.any_ok() {
        created.push(PathBuf::from(parent).join(name).to_string_lossy().into_owned());
    }
    let label = if folder { "フォルダーの作成" } else { "ファイルの作成" };
    let entry = (!created.is_empty()).then(|| Entry::Trash { paths: created.clone(), label });
    Ok((out.result(created), entry))
}

// ---------------------------------------------------------------------------------------------
// undo

pub(crate) fn undo_sync(owner: isize, silent: bool) -> Result<Option<String>, String> {
    let entry = history().lock().unwrap_or_else(|e| e.into_inner()).pop_back();
    let Some(entry) = entry else { return Ok(None) };
    let (result, left) = undo_entry(entry, owner, silent);
    // What could not be undone but is still there goes back, so the next undo tries it again
    // instead of silently moving on to the operation before it.
    if let Some(left) = left {
        record(left);
    }
    result.map(Some)
}

const NOT_FOUND: &str = "元に戻す対象の項目が見つかりません";
const NAME_TAKEN: &str = "元の場所に同じ名前の項目があるため、戻せません";

fn exists(path: &str) -> bool {
    Path::new(path).exists()
}

/// Undoes `entry`. Also returns the part of it that was not undone and still can be.
fn undo_entry(entry: Entry, owner: isize, silent: bool) -> (Result<String, String>, Option<Entry>) {
    match entry {
        Entry::Rename { current, old_name } => {
            if !exists(&current) {
                return (Err(NOT_FOUND.into()), None);
            }
            let done = rename_raw(&current, &old_name, owner, silent).and_then(|out| out.require_some());
            // (Not just "still there": after undoing a change of case, `current` still matches.)
            let left = (done.is_err() && exists(&current)).then_some(Entry::Rename { current, old_name });
            (done.map(|()| "名前の変更を元に戻しました".into()), left)
        }
        Entry::Move { items } => {
            // Never replaces what is at the original place now, like undoing a delete.
            let present: Vec<(String, String)> = items.into_iter().filter(|(c, _)| exists(c)).collect();
            let (blocked, free): (Vec<_>, Vec<_>) = present.into_iter().partition(|(_, o)| exists(o));
            if free.is_empty() {
                let e = if blocked.is_empty() { NOT_FOUND } else { NAME_TAKEN };
                return (Err(e.into()), (!blocked.is_empty()).then_some(Entry::Move { items: blocked }));
            }
            let done = run_session(owner, NO_FLAGS, silent, |op| unsafe {
                for (current, original) in &free {
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
            .and_then(|out| out.require_some());
            let left: Vec<_> = free.into_iter().chain(blocked).filter(|(c, _)| exists(c)).collect();
            let done = match done {
                Ok(()) if left.is_empty() => Ok("移動を元に戻しました".into()),
                Ok(()) => Ok("移動を元に戻しました（戻せなかった項目があります）".into()),
                Err(e) => Err(e),
            };
            (done, (!left.is_empty()).then_some(Entry::Move { items: left }))
        }
        Entry::Trash { paths, label } => {
            let existing: Vec<String> = paths.into_iter().filter(|p| exists(p)).collect();
            if existing.is_empty() {
                return (Err(NOT_FOUND.into()), None);
            }
            let done = recycle(&existing, owner, silent).and_then(|out| out.require_some());
            let left: Vec<String> = existing.into_iter().filter(|p| exists(p)).collect();
            (
                done.map(|()| format!("{label}を元に戻しました")),
                (!left.is_empty()).then_some(Entry::Trash { paths: left, label }),
            )
        }
        Entry::Restore { items } => {
            let mut errors = Vec::new();
            let mut left = Vec::new();
            for (original, bin_path) in items {
                if let Err(e) = restore_one(&original, &bin_path, owner, silent) {
                    errors.push(format!("{original}: {e}"));
                    if exists(&bin_path) {
                        left.push((original, bin_path));
                    }
                }
            }
            let done = if errors.is_empty() {
                Ok("削除を元に戻しました".into())
            } else {
                Err(errors.join("\n"))
            };
            (done, (!left.is_empty()).then_some(Entry::Restore { items: left }))
        }
    }
}

/// Restores a Recycle Bin item to `original` with the "undelete" verb of the item in the Recycle
/// Bin folder; falls back to moving the `$R...` file back. Never replaces what is at `original`
/// now (the verb would ask to, with the Windows dialog).
fn restore_one(original: &str, bin_path: &str, owner: isize, silent: bool) -> Result<(), String> {
    if exists(original) {
        return Err(NAME_TAKEN.into());
    }
    let verb = match find_in_recycle_bin(bin_path) {
        Some(pidl) => invoke_verb(&pidl, b"undelete\0", owner, silent),
        None => Err("ごみ箱の中に項目が見つかりません".to_string()),
    };
    if verb.is_ok() && Path::new(original).exists() {
        return Ok(());
    }
    let verb_err = verb.err().unwrap_or_else(|| "元の場所に戻りませんでした".into());
    move_back(bin_path, original).map_err(|e| format!("{verb_err}; {e}"))
}

/// Moves the Recycle Bin file back by hand. Never replaces what is at `original` now:
/// something else may have been created there since the delete (`fs::rename` would overwrite it).
fn move_back(bin_path: &str, original: &str) -> Result<(), String> {
    if exists(original) {
        return Err(NAME_TAKEN.into());
    }
    std::fs::rename(bin_path, original).map_err(|e| e.to_string())
}

/// Looks up the Recycle Bin folder item whose file system path is `bin_path` and returns its
/// absolute PIDL (a plain file PIDL has no "undelete" verb).
fn find_in_recycle_bin(bin_path: &str) -> Option<Pidl> {
    unsafe {
        let bin = shell_item("::{645FF040-5081-101B-9F08-00AA002F954E}").ok()?;
        let items: IEnumShellItems = bin.BindToHandler(None::<&IBindCtx>, &BHID_EnumItems).ok()?;
        loop {
            let mut buf = [None];
            let mut fetched = 0u32;
            let hr = items.Next(&mut buf, Some(&mut fetched));
            if hr.is_err() || fetched == 0 {
                return None;
            }
            let item = buf[0].take()?;
            if let Ok(p) = item_name(&item, SIGDN_FILESYSPATH)
                && p.eq_ignore_ascii_case(bin_path)
            {
                return SHGetIDListFromObject(&item).ok().map(Pidl);
            }
        }
    }
}

fn invoke_verb(pidl: &Pidl, verb: &'static [u8], owner: isize, silent: bool) -> Result<(), String> {
    unsafe {
        // Bind through the parent folder (the Recycle Bin) like Explorer does.
        let mut last: *mut ITEMIDLIST = std::ptr::null_mut();
        let folder: IShellFolder = SHBindToParent(pidl.as_ptr(), Some(&mut last)).map_err(err)?;
        let cm: IContextMenu = folder
            .GetUIObjectOf(HWND(owner as _), &[last as *const ITEMIDLIST], None)
            .map_err(err)?;
        let menu = CreatePopupMenu().map_err(err)?;
        let q = cm.QueryContextMenu(menu, 0, 1, 0x7FFF, CMF_NORMAL);
        let result = if q.is_err() {
            Err(hr_message(q))
        } else {
            // Find the command by its canonical verb and invoke it by offset: more reliable than
            // passing the verb string to shell folders that only match menu offsets.
            let count = (q.0 as u32) & 0xFFFF;
            let want = std::str::from_utf8(&verb[..verb.len() - 1]).unwrap_or_default();
            let mut offset = None;
            for id in 0..count {
                let mut buf = [0u16; 128];
                let got = cm.GetCommandString(
                    id as usize,
                    GCS_VERBW,
                    None,
                    PSTR(buf.as_mut_ptr() as *mut u8),
                    buf.len() as u32,
                );
                if got.is_ok() {
                    let name = com::from_wide_buf(&buf);
                    if name.eq_ignore_ascii_case(want) {
                        offset = Some(id);
                    }
                }
            }
            let lp_verb = match offset {
                Some(id) => PCSTR(id as usize as *const u8),
                None => PCSTR(verb.as_ptr()),
            };
            let info = CMINVOKECOMMANDINFO {
                cbSize: std::mem::size_of::<CMINVOKECOMMANDINFO>() as u32,
                fMask: CMIC_MASK_NOASYNC | if silent { CMIC_MASK_FLAG_NO_UI } else { 0 },
                hwnd: HWND(owner as _),
                lpVerb: lp_verb,
                nShow: SW_SHOWNORMAL.0,
                ..Default::default()
            };
            cm.InvokeCommand(&info).map_err(err)
        };
        let _ = DestroyMenu(menu);
        result
    }
}

// ---------------------------------------------------------------------------------------------
// tests

#[cfg(test)]
mod move_back_tests {
    use super::move_back;

    #[test]
    fn does_not_overwrite_an_existing_item() {
        let dir = std::env::temp_dir().join(format!("vesta-moveback-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (bin, orig) = (dir.join("bin.txt"), dir.join("orig.txt"));
        std::fs::write(&bin, "deleted").unwrap();
        std::fs::write(&orig, "new").unwrap();
        let (b, o) = (bin.to_string_lossy().into_owned(), orig.to_string_lossy().into_owned());
        assert!(move_back(&b, &o).is_err());
        assert_eq!(std::fs::read_to_string(&orig).unwrap(), "new");
        assert!(bin.exists());
        std::fs::remove_file(&orig).unwrap();
        assert!(move_back(&b, &o).is_ok());
        assert_eq!(std::fs::read_to_string(&orig).unwrap(), "deleted");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    /// Runs `f` as one job on the op thread so history stays consistent between steps.
    fn on_op<F: FnOnce() + Send + 'static>(f: F) {
        com::op_pool().run_blocking(f).unwrap();
    }

    fn exec(op: FileOp) -> OpResult {
        execute_sync(op, 0, true).unwrap()
    }

    fn undo_it() -> String {
        undo_sync(0, true).unwrap().expect("history entry")
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
            let r = exec(FileOp::Copy { sources: vec![a], dest: d });
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
            let r = exec(FileOp::Move { sources: vec![a], dest: d });
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
            let r = exec(FileOp::Rename { path: p, new_name: "new.txt".into() });
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
            let r1 = exec(FileOp::NewFolder { parent: parent.clone(), name: "newdir".into() });
            assert!(dir.join("newdir").is_dir());
            assert_eq!(r1.created.len(), 1);
            let r2 = exec(FileOp::NewFolder { parent: parent.clone(), name: "newdir".into() });
            assert_eq!(r2.created.len(), 1);
            assert_ne!(r2.created[0], r1.created[0]);
            assert!(Path::new(&r2.created[0]).is_dir());

            let f1 = exec(FileOp::NewFile { parent: parent.clone(), name: "n.txt".into() });
            assert!(dir.join("n.txt").is_file());
            let f2 = exec(FileOp::NewFile { parent: parent.clone(), name: "n.txt".into() });
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
            let r = exec(FileOp::Link { sources: vec![p.clone()], dest: d.clone() });
            assert_eq!(r.created.len(), 1);
            let first = PathBuf::from(&r.created[0]);
            let name = first.file_name().unwrap().to_string_lossy().into_owned();
            assert_eq!(name, "t.txt - ショートカット.lnk");
            assert!(first.is_file());
            let r2 = exec(FileOp::Link { sources: vec![p], dest: d });
            assert!(r2.created[0].ends_with("t.txt - ショートカット (2).lnk"));
            undo_it();
            undo_it();
            assert!(names(&dest).is_empty());
        });
    }

    #[test]
    fn recycle_then_undo_restores_same_path() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("avesta-recycle-test.txt");
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
    fn permanent_delete_is_not_recorded() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("gone.txt");
        fs::write(&file, "x").unwrap();
        let p = s(&file);
        on_op(move || {
            let before = history().lock().unwrap().len();
            let r = exec(FileOp::Delete { paths: vec![p] });
            assert!(!r.undoable);
            assert!(!file.exists());
            assert_eq!(history().lock().unwrap().len(), before);
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
    fn is_inside_matches_items_below_a_folder_only() {
        assert!(is_inside(r"C:\a\b\c.txt", r"C:\a\b"));
        assert!(is_inside(r"C:\A\B\c.txt", r"c:\a\b\"));
        assert!(!is_inside(r"C:\a\b", r"C:\a\b"));
        assert!(!is_inside(r"C:\a\bc\d.txt", r"C:\a\b"));
        assert!(!is_inside(r"C:\a\b", ""));
        assert!(!is_inside(r"C:\あ\い", r"C:\あい"));
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
            let before = history().lock().unwrap().len();
            let r = exec(FileOp::Copy { sources: vec![a], dest: d });
            assert!(r.replaced && !r.undoable);
            assert_eq!(history().lock().unwrap().len(), before);
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
            let r = exec(FileOp::Copy { sources: vec![a.clone()], dest: d.clone() });
            assert_eq!(r.created.len(), 1, "only the folder itself: {:?}", r.created);
            assert!(dst.join("dir").join("sub").join("deep.txt").exists());
            undo_it();
            assert!(names(&dst).is_empty());

            let r = exec(FileOp::Move { sources: vec![a], dest: d });
            assert_eq!(r.created.len(), 1);
            assert!(!src.join("dir").exists());
            undo_it();
            assert!(names(&dst).is_empty());
            assert_eq!(fs::read_to_string(src.join("dir").join("sub").join("deep.txt")).unwrap(), "2");
        });
    }

    #[test]
    fn undo_of_a_move_does_not_replace_and_can_be_tried_again() {
        let (_tmp, src, dst) = two_dirs();
        fs::write(src.join("m.txt"), "moved").unwrap();
        let (a, d) = (s(&src.join("m.txt")), s(&dst));
        on_op(move || {
            exec(FileOp::Move { sources: vec![a], dest: d });
            fs::write(src.join("m.txt"), "newer").unwrap();
            assert_eq!(undo_sync(0, true), Err(NAME_TAKEN.to_string()));
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
            let e = undo_sync(0, true).unwrap_err();
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
            exec(FileOp::Copy { sources: vec![a], dest: d });
            fs::remove_file(dst.join("g.txt")).unwrap();
            let before = history().lock().unwrap().len();
            assert_eq!(undo_sync(0, true), Err(NOT_FOUND.to_string()));
            assert_eq!(history().lock().unwrap().len(), before - 1);
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
            let entry = listed.entries.iter().find(|e| e.name == name).expect("listed with the same name");
            assert!(Path::new(&entry.location).exists());

            let r = exec(FileOp::Copy { sources: vec![f.clone()], dest: d.clone() });
            let copied = PathBuf::from(&r.created[0]);
            assert_eq!(copied.file_name().unwrap().to_string_lossy(), "日本語 フォルダ 😀");
            assert_eq!(fs::read_to_string(copied.join(name)).unwrap(), "中身");

            let r = exec(FileOp::Rename { path: s(&copied.join(name)), new_name: "新しい名前🍣.txt".into() });
            assert!(r.created[0].ends_with("新しい名前🍣.txt"));
            assert!(copied.join("新しい名前🍣.txt").exists());

            let r = exec(FileOp::Recycle { paths: vec![s(&copied.join("新しい名前🍣.txt"))] });
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
            println!("copy in: {:?}", execute_sync(FileOp::Copy { sources: vec![a], dest: d.clone() }, 0, true));
            let inside = format!("{d}\\inside.txt");
            println!(
                "rename: {:?}",
                execute_sync(FileOp::Rename { path: inside.clone(), new_name: "renamed.txt".into() }, 0, true)
            );
            let renamed = format!("{d}\renamed.txt");
            println!("recycle: {:?}", execute_sync(FileOp::Recycle { paths: vec![renamed] }, 0, true));
            println!("undo: {:?}", undo_sync(0, true));
            println!("new folder: {:?}", execute_sync(FileOp::NewFolder { parent: d, name: "n".into() }, 0, true));
        });
    }

    #[test]
    fn undo_on_empty_history_is_none() {
        on_op(|| {
            while undo_sync(0, true).map(|r| r.is_some()).unwrap_or(true) {}
            assert_eq!(undo_sync(0, true).unwrap(), None);
        });
    }
}
