// Decisions about file operations, apart from running them. Spec: docs/spec/fileops.md

import type { FileOp, OpResult } from "../api/types";
import type { Mods } from "./navigation";
import { sameVolume, splitByParent } from "./paths";

export type TransferKind = "copy" | "move" | "link";

/** What a left-button drop of `paths` on `dest` does, from the modifier keys and the drives. */
export function dropKind(paths: string[], dest: string, mods: Mods, copyBetweenDrives: boolean): TransferKind {
  if (mods.alt || (mods.ctrl && mods.shift)) return "link";
  if (mods.ctrl) return "copy";
  if (mods.shift) return "move";
  if (paths.every((p) => sameVolume(p, dest))) return "move";
  return copyBetweenDrives ? "copy" : "move";
}

/**
 * The operations that put `paths` into `dest`. Items already in `dest` are treated apart:
 * moving them does nothing, copying them makes duplicates ("- コピー").
 */
export function transferOps(kind: TransferKind, paths: string[], dest: string): FileOp[] {
  if (!paths.length) return [];
  if (kind === "link") return [{ kind, sources: paths, dest }];
  const { same, other } = splitByParent(paths, dest);
  const ops: FileOp[] = [];
  if (other.length) ops.push({ kind, sources: other, dest });
  if (same.length && kind === "copy") ops.push({ kind: "duplicate", sources: same });
  return ops;
}

/** Programs and scripts that take dropped files as their arguments (as in Explorer). */
const DROP_PROGRAMS = new Set(["exe", "com", "bat", "cmd", "vbs", "js", "wsf"]);

/**
 * Whether a listed item that is not a folder takes a drop: a shortcut (to a program or to a
 * folder), or a program itself. Other files do not; a drop over them goes to their folder.
 */
export function takesDrop(entry: { name: string; isFolder: boolean; isLink: boolean }): boolean {
  if (entry.isFolder) return false;
  if (entry.isLink) return true;
  const dot = entry.name.lastIndexOf(".");
  return dot > 0 && DROP_PROGRAMS.has(entry.name.slice(dot + 1).toLowerCase());
}

/**
 * Where a paste goes: the pane's folder, or (PasteInFolder) the one selected item when it is a
 * folder.
 */
export function pasteDest(
  folder: string,
  selected: { location: string; isFolder: boolean }[],
  pasteInFolder: boolean,
): string {
  return pasteInFolder && selected.length === 1 && selected[0].isFolder ? selected[0].location : folder;
}

/** The shown pane after `id` (wrapping), for MoveToOther / CopyToOther; null when it is the only one. */
export function nextShown(shown: string[], id: string | null): string | null {
  if (shown.length < 2) return null;
  return shown[(shown.indexOf(id ?? "") + 1) % shown.length];
}

/** Last part of a location. */
const leaf = (location: string) => location.split("\\").pop() ?? location;

/** A name without its extension (a leading dot is part of the name, not an extension). */
function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * The lines Current.Copy.* puts on the clipboard for `locations`: full paths, names, or names
 * without extension. `nameOf` gives the listed name of a location when it is known.
 */
export function copyLines(
  locations: string[],
  what: "path" | "name" | "base",
  nameOf: (location: string) => string | undefined,
): string[] {
  return locations.map((l) => {
    if (what === "path") return l;
    const name = nameOf(l) ?? leaf(l);
    return what === "name" ? name : baseName(name);
  });
}

/** The status bar text after copying `lines`. */
export function copiedMessage(lines: string[]): string {
  return lines[0] + (lines.length > 1 ? ` ほか ${lines.length - 1} 件` : "") + " をコピーしました";
}

/** The part of a name selected in the rename box: all of it, without the extension, or the extension. */
export type RenamePart = "all" | "base" | "ext";

/**
 * The range of `name` to select for `part`, as [start, end). The extension is what follows the
 * last dot (not the dot itself). A folder, a name without a dot and a name that only starts
 * with one (`.gitignore`) have no extension to tell apart: all of the name is selected.
 */
export function renameSelection(name: string, isFolder: boolean, part: RenamePart): [number, number] {
  const dot = name.lastIndexOf(".");
  if (part === "all" || isFolder || dot <= 0) return [0, name.length];
  return part === "base" ? [0, dot] : [dot + 1, name.length];
}

/** The part selected by running the rename command again while renaming: extension and name in turn. */
export function nextRenamePart(part: RenamePart): RenamePart {
  return part === "ext" ? "base" : "ext";
}

/** The new name to rename `location` to, or null when `typed` is empty or leaves the name as it is. */
export function renameTo(location: string, typed: string): string | null {
  const name = typed.trim();
  return !name || name === leaf(location) ? null : name;
}

/**
 * The command for a verb the Shell context menu hands back (the menu leaves these to the app).
 * `shift` is whether Shift is held: Delete then removes for good. Null for a verb the Shell
 * has already carried out, or none.
 */
export function verbCommand(verb: string | null, shift: boolean): string | null {
  switch (verb) {
    case "rename":
      return "Current.Rename";
    case "delete":
      return shift ? "Current.Bury" : "Current.Delete";
    case "cut":
      return "Current.Cut";
    case "copy":
      return "Current.Copy";
    case "paste":
      return "Current.Paste";
    case "properties":
      return "Current.Property";
    default:
      return null;
  }
}

/** The status bar text for the result of an operation, or null when there is nothing to say. */
export function resultMessage(r: Pick<OpResult, "aborted" | "done" | "replaced">): string | null {
  if (r.aborted) return r.done ? "一部の項目は処理されませんでした" : "操作を中止しました";
  if (r.replaced) return "同じ名前があった項目は、元に戻す対象になりません";
  return null;
}
