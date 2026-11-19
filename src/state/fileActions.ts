// File operations from commands, menus and drag & drop. Spec: docs/spec/fileops.md

import { backend } from "../api/backend";
import type { FileOp } from "../api/types";
import { errorText } from "../model/input";
import type { Mods } from "../model/navigation";
import { newItemKind } from "../model/newItem";
import {
  copiedMessage,
  copyLines,
  dropKind,
  nextRenamePart,
  nextShown,
  pasteDest,
  renameTo,
  resultMessage,
  transferOps,
  type TransferKind,
} from "../model/fileOps";
import { shownTabs } from "../model/tabs";
import { reloadPane } from "./loading";
import { setMessage } from "./message";
import { exclusive } from "./exclusive";
import { selectedEntries } from "./selection";
import { getState, updatePane } from "./store";

function paneOf(id: string | null) {
  return id ? getState().panes[id] ?? null : null;
}

/** Selected locations, or [] when nothing is selected. */
export function selectedLocations(id: string | null): string[] {
  const p = paneOf(id);
  return p ? selectedEntries(p).map((e) => e.location) : [];
}

function folderPath(id: string | null): string | null {
  return paneOf(id)?.folder?.location ?? null;
}

/** Reads every shown pane again; `select` names an item to select in one of them. */
async function reloadShown(select?: { paneId: string; location: string }) {
  await Promise.all(
    shownTabs(getState().tabs).map((t) => reloadPane(t.id, select && t.id === select.paneId ? select.location : undefined)),
  );
}

/** An item to select in a pane after an operation (the first created item), optionally renaming it. */
interface SelectAfter {
  paneId: string;
  rename?: boolean;
}

/**
 * Runs the operations in order (stopping at the first error or cancel), then reloads the shown
 * panes. True when every operation ran to the end. One call runs at a time (`exclusive`); a
 * call that is turned away does nothing and gives false.
 */
async function run(ops: FileOp | FileOp[], after?: SelectAfter): Promise<boolean> {
  const done = await exclusive(() => runNow(ops, after));
  return done ?? false;
}

async function runNow(ops: FileOp | FileOp[], after?: SelectAfter): Promise<boolean> {
  let created: string | undefined;
  let complete = true;
  try {
    for (const op of Array.isArray(ops) ? ops : [ops]) {
      const r = await backend.fileOp(op);
      created ??= r.created[0];
      const message = resultMessage(r);
      if (message) setMessage(message);
      if (r.aborted) {
        complete = false;
        // Cancelled outright: the operations after it are not wanted either.
        if (!r.done) break;
      }
    }
  } catch (e) {
    complete = false;
    setMessage(errorText(e));
  }
  // Watchers reload changed folders; reload shown panes too in case the folder is not watchable.
  const select = after && created;
  await reloadShown(after && created ? { paneId: after.paneId, location: created } : undefined);
  if (after?.rename && select && getState().panes[after.paneId]?.selected.has(select)) {
    startRename(after.paneId, select);
  }
  return complete;
}

export async function copyOrCut(id: string | null, cut: boolean) {
  const paths = selectedLocations(id);
  if (!paths.length) return;
  try {
    await backend.clipboardSetFiles(paths, cut);
    setMessage(`${paths.length} 個の項目を${cut ? "切り取り" : "コピー"}しました`, 2000);
  } catch (e) {
    setMessage(errorText(e));
  }
}

export async function paste(id: string | null) {
  const p = paneOf(id);
  const folder = folderPath(id);
  if (!p || !folder) return;
  const dest = pasteDest(folder, selectedEntries(p), getState().options.PasteInFolder);
  const clip = await backend.clipboardGetFiles().catch(() => null);
  if (!clip || !clip.paths.length) {
    setMessage("貼り付けるファイルがありません");
    return;
  }
  // Items pasted back into their own folder: copies become duplicates ("- コピー"), cut ones stay put.
  const ops = transferOps(clip.cut ? "move" : "copy", clip.paths, dest);
  if (!ops.length) return;
  const complete = await run(ops);
  // Cut items are gone from where the clipboard says: pasting them again would only fail.
  if (clip.cut && complete) await backend.clipboardClear().catch(() => undefined);
}

export async function recycle(id: string | null) {
  const paths = selectedLocations(id);
  if (paths.length) await run({ kind: "recycle", paths });
}

export async function bury(id: string | null) {
  const paths = selectedLocations(id);
  if (paths.length) await run({ kind: "delete", paths });
}

export async function duplicate(id: string | null) {
  const sources = selectedLocations(id);
  if (sources.length) await run({ kind: "duplicate", sources });
}

export async function toOther(id: string | null, kind: "copy" | "move") {
  const sources = selectedLocations(id);
  const dest = folderPath(nextShown(shownTabs(getState().tabs).map((t) => t.id), id));
  if (!sources.length) return;
  if (!dest) {
    setMessage("ほかに表示中のペインがありません");
    return;
  }
  const ops = transferOps(kind, sources, dest);
  if (ops.length) await run(ops);
}

export async function newFolder(id: string | null) {
  const parent = folderPath(id);
  if (!parent || !id) return;
  await run({ kind: "newFolder", parent, name: "新しいフォルダー" }, { paneId: id, rename: true });
}

/** Current.New: a file when `name` has an extension, else a folder. */
export async function newItem(id: string | null, name: string) {
  const parent = folderPath(id);
  const kind = newItemKind(name);
  if (!parent || !id || !kind) return;
  const op: FileOp = { kind: kind === "file" ? "newFile" : "newFolder", parent, name: name.trim() };
  await run(op, { paneId: id });
}

/** Renames `location`; the renamed item stays selected in pane `id`. */
export async function rename(id: string, location: string, newName: string) {
  const name = renameTo(location, newName);
  if (name) await run({ kind: "rename", path: location, newName: name }, { paneId: id });
}

/** Drop of `paths` onto `dest` (folder location). Decides copy/move/link from modifiers and drives. */
export async function dropFiles(paths: string[], dest: string, mods: Mods) {
  if (!paths.length) return;
  await dropFilesAs(dropKind(paths, dest, mods, getState().options.DnDCopyInterDrv), paths, dest);
}

/** Drops `paths` on `dest` the given way (the choice of the right-button drop menu, or of `dropFiles`). */
export async function dropFilesAs(kind: TransferKind, paths: string[], dest: string) {
  const ops = transferOps(kind, paths, dest);
  if (ops.length) await run(ops);
}

/**
 * Puts files saved from a drop without paths (temporary files written by the drop target) into
 * `dest`. Always a move, whatever the modifier keys: the temporary files are ours.
 */
export async function saveDropped(paths: string[], dest: string) {
  if (paths.length) await run({ kind: "move", sources: paths, dest });
}

export async function undo() {
  // A file operation like the others: undoing a big move takes as long as the move did.
  await exclusive(async () => {
    try {
      const msg = await backend.undo();
      setMessage(msg ?? "元に戻す操作はありません");
    } catch (e) {
      setMessage(errorText(e));
    }
    await reloadShown();
  });
}

export async function copyNames(id: string | null, what: "path" | "name" | "base") {
  let locs = selectedLocations(id);
  if (!locs.length) {
    const f = folderPath(id);
    if (f) locs = [f];
  }
  const p = paneOf(id);
  const lines = copyLines(locs, what, (loc) => p?.entries.find((e) => e.location === loc)?.name);
  if (!lines.join("")) return;
  try {
    await backend.clipboardSetText(lines.join("\r\n"));
  } catch (e) {
    setMessage(errorText(e));
    return;
  }
  setMessage(copiedMessage(lines), 2000);
}

export async function properties(id: string | null) {
  const locs = selectedLocations(id);
  const target = locs.length ? locs : [folderPath(id)].filter((x): x is string => !!x);
  if (target.length) await backend.openItems(target, "properties").catch((e) => setMessage(errorText(e)));
}

/** Opens the rename box on `location`, with the name selected as the RenameExtension option says. */
function startRename(id: string, location: string) {
  const renamePart = getState().options.RenameExtension ? "base" : "all";
  updatePane(id, () => ({ renaming: location, renamePart }));
}

/**
 * Current.Rename: starts in-place rename of the cursor item (or the first selected). Run again
 * while renaming, it selects the extension, then the name without it, in turn.
 */
export function beginRename(id: string | null) {
  const p = paneOf(id);
  if (!p || !id) return;
  if (p.renaming) {
    updatePane(id, (now) => ({ renamePart: nextRenamePart(now.renamePart) }));
    return;
  }
  const loc = p.cursor && p.selected.has(p.cursor) ? p.cursor : selectedLocations(id)[0];
  if (loc) startRename(id, loc);
}
