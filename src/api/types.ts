// Mirror of src-tauri/src/types.rs. Change both together.

export interface FolderInfo {
  /** File system path, Shell parsing name (`::{GUID}`, `\\server`) or `DESKTOP` (namespace root). */
  location: string;
  displayName: string;
  fsPath: string | null;
  parent: string | null;
  syncRoot: boolean;
  /** Path of the cloud sync root the folder is in (the root itself included), else null. */
  syncRootPath: string | null;
}

export type SyncState = "pinned" | "available" | "onlineOnly";

export interface Entry {
  name: string;
  location: string;
  isFolder: boolean;
  isLink: boolean;
  size: number | null;
  /** Unix milliseconds. */
  modified: number | null;
  /** Unix milliseconds. */
  created: number | null;
  /** Unix milliseconds. */
  accessed: number | null;
  /** FILE_ATTRIBUTE_* flags; null when unknown (virtual items). */
  attributes: number | null;
  typeName: string;
  hidden: boolean;
  system: boolean;
  syncState: SyncState | null;
}

export interface Listing {
  folder: FolderInfo;
  entries: Entry[];
  elapsedMs: number;
}

export type Resolved =
  | { kind: "folder"; folder: FolderInfo }
  | { kind: "file"; location: string };

export interface DiskFree {
  label: string;
  free: number;
  total: number;
}

export interface Modifiers {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export type FileOp =
  | { kind: "copy"; sources: string[]; dest: string }
  | { kind: "move"; sources: string[]; dest: string }
  | { kind: "link"; sources: string[]; dest: string }
  | { kind: "duplicate"; sources: string[] }
  | { kind: "recycle"; paths: string[] }
  | { kind: "delete"; paths: string[] }
  | { kind: "rename"; path: string; newName: string }
  | { kind: "newFolder"; parent: string; name: string }
  | { kind: "newFile"; parent: string; name: string };

export interface OpResult {
  created: string[];
  undoable: boolean;
  /** The user cancelled, or some items were skipped. */
  aborted: boolean;
  /** At least one item was processed. */
  done: boolean;
  /** Some items replaced, or merged into, items of the same name; those are not in the undo history. */
  replaced: boolean;
}

export interface ClipFiles {
  paths: string[];
  cut: boolean;
}

/** Where the window is (physical pixels, the restored rectangle even while maximized). docs/spec/ui.md */
export interface WindowPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}
