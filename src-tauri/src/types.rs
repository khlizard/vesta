//! Types exchanged with the frontend (serialised as camelCase JSON).
//! Mirror: `src/api/types.ts`. Change both together.

use serde::{Deserialize, Serialize};

/// A folder that can be shown in a pane.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    /// Canonical location: a file system path (`C:\foo`, `\\server\share`)
    /// or a Shell parsing name for virtual folders (`::{20D04FE0-...}`, `\\server`).
    pub location: String,
    /// Name as Explorer shows it.
    pub display_name: String,
    /// Set when the folder is a real directory.
    pub fs_path: Option<String>,
    /// Location of the parent folder. `None` only for the Desktop.
    pub parent: Option<String>,
    /// True when the folder is inside a cloud sync root (shows the 状態 column).
    pub sync_root: bool,
    /// Path of the cloud sync root the folder is in (the root itself included); its icon is
    /// shown in the address bar.
    pub sync_root_path: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SyncState {
    /// Always kept on this device.
    Pinned,
    /// Downloaded, may be freed.
    Available,
    /// Placeholder only.
    OnlineOnly,
}

/// One item in a folder.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// File name for real files (always with extension), display name for virtual items.
    pub name: String,
    /// Location to pass back to other commands (full path or Shell parsing name).
    pub location: String,
    /// The item can be navigated into (folder, drive, share, virtual folder).
    pub is_folder: bool,
    /// The item is a shortcut (.lnk / .url).
    pub is_link: bool,
    /// Bytes. `None` for folders and items without a size.
    pub size: Option<u64>,
    /// Last write time in Unix milliseconds.
    pub modified: Option<i64>,
    /// Creation time in Unix milliseconds.
    pub created: Option<i64>,
    /// Last access time in Unix milliseconds.
    pub accessed: Option<i64>,
    /// `FILE_ATTRIBUTE_*` flags. `None` when unknown (virtual items).
    pub attributes: Option<u32>,
    /// Explorer's type name (e.g. "テキスト ドキュメント").
    pub type_name: String,
    pub hidden: bool,
    pub system: bool,
    /// Cloud sync state. `None` outside sync roots.
    pub sync_state: Option<SyncState>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub folder: FolderInfo,
    pub entries: Vec<Entry>,
    pub elapsed_ms: u64,
}

/// Result of resolving a user-typed location.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Resolved {
    Folder { folder: FolderInfo },
    File { location: String },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiskFree {
    /// Drive letter (`D`) or server name for UNC paths.
    pub label: String,
    pub free: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Modifiers {
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
}

/// A file operation requested by the frontend.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FileOp {
    Copy {
        sources: Vec<String>,
        dest: String,
    },
    Move {
        sources: Vec<String>,
        dest: String,
    },
    /// Create shortcuts to `sources` in `dest`.
    Link {
        sources: Vec<String>,
        dest: String,
    },
    /// Copy into the same folder ("- コピー" names).
    Duplicate {
        sources: Vec<String>,
    },
    /// Send to the Recycle Bin.
    Recycle {
        paths: Vec<String>,
    },
    /// Delete permanently.
    Delete {
        paths: Vec<String>,
    },
    Rename {
        path: String,
        new_name: String,
    },
    NewFolder {
        parent: String,
        name: String,
    },
    NewFile {
        parent: String,
        name: String,
    },
}

#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpResult {
    /// Locations of items created by the operation (copies, moved items, new items).
    pub created: Vec<String>,
    /// The operation was recorded in the undo history.
    pub undoable: bool,
    /// The user cancelled, or some items were skipped.
    pub aborted: bool,
    /// At least one item was processed.
    pub done: bool,
    /// Some items replaced, or merged into, items of the same name. Those are not in the undo history.
    pub replaced: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClipFiles {
    pub paths: Vec<String>,
    /// True when the files were cut (Preferred DropEffect = MOVE).
    pub cut: bool,
}
