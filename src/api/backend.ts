// Typed wrappers around the Tauri commands in src-tauri/src/lib.rs.

import { invoke } from "@tauri-apps/api/core";
import type {
  ClipFiles,
  DiskFree,
  FileOp,
  FolderInfo,
  Listing,
  Modifiers,
  OpResult,
  Resolved,
  UiConfigResponse,
  WindowPlacement,
} from "./types";

export const backend = {
  /** usr/*.xml as read by the backend; `warnings` names the files that fell back to the built-in ones. */
  uiConfig: () => invoke<UiConfigResponse>("get_ui_config"),
  listFolder: (location: string, showHidden: boolean) => invoke<Listing>("list_folder", { location, showHidden }),
  resolveLocation: (input: string) => invoke<Resolved>("resolve_location", { input }),
  folderAncestors: (location: string) => invoke<FolderInfo[]>("folder_ancestors", { location }),
  diskFree: (location: string) => invoke<DiskFree | null>("disk_free", { location }),
  watchFolders: (locations: string[], fresh = false) => invoke<void>("watch_folders", { locations, fresh }),
  openItems: (locations: string[], verb?: string, args?: string, cwd?: string) =>
    invoke<void>("open_items", { locations, verb, args, cwd }),
  keyState: () => invoke<Modifiers>("key_state"),
  fileOp: (op: FileOp) => invoke<OpResult>("file_op", { op }),
  undo: () => invoke<string | null>("undo"),
  clipboardSetFiles: (paths: string[], cut: boolean) => invoke<void>("clipboard_set_files", { paths, cut }),
  clipboardGetFiles: () => invoke<ClipFiles | null>("clipboard_get_files"),
  clipboardSetText: (text: string) => invoke<void>("clipboard_set_text", { text }),
  clipboardClear: () => invoke<void>("clipboard_clear"),
  showContextMenu: (folder: string, items: string[], x: number, y: number) =>
    invoke<string | null>("show_context_menu", { folder, items, x, y }),
  startDrag: (locations: string[]) => invoke<string>("start_drag", { locations }),
  /** Shows the Shell's right-button drop menu at (x, y) (physical pixels) and lets the Shell do the choice. */
  rightDrop: (sources: string[], folder: string, x: number, y: number) =>
    invoke<void>("right_drop", { sources, folder, x, y }),
  /** Drops `sources` on a program or shortcut: the Shell does what Explorer would (x, y: physical px in the window). */
  dropOnItem: (sources: string[], item: string, x: number, y: number, rightButton: boolean) =>
    invoke<void>("drop_on_item", { sources, item, x, y, rightButton }),
  readState: (name: string) => invoke<string | null>("read_state", { name }),
  writeState: (name: string, json: string) => invoke<void>("write_state", { name, json }),
  /** Sets an unreadable var/<name>.json aside as <name>.bad.json. */
  keepBadState: (name: string) => invoke<void>("keep_bad_state", { name }),
  /** Appends a line to var/vesta.log. */
  logLine: (text: string) => invoke<void>("log_line", { text }),
  /** The folder a shortcut (.lnk) points to, or null. */
  linkFolder: (location: string) => invoke<FolderInfo | null>("link_folder", { location }),
  /** Folders and files given on the command line of this instance. */
  startupPaths: () => invoke<string[]>("startup_paths"),
  /** Expands `%NAME%` environment variables in text from a settings file. */
  expandEnv: (text: string) => invoke<string>("expand_env", { text }),
  /** Position, size and maximized state of the window, for session.json. */
  windowPlacement: () => invoke<WindowPlacement>("window_placement"),
  /** Checks for and downloads an update; the version ready to apply, or null (docs/spec/update.md). */
  updateCheck: () => invoke<string | null>("update_check"),
  /** Applies the downloaded update and restarts the app. */
  updateRestart: () => invoke<void>("update_restart"),
};
