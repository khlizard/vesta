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

/** The new name to rename `location` to, or null when `typed` is empty or leaves the name as it is. */
export function renameTo(location: string, typed: string): string | null {
  const name = typed.trim();
  return !name || name === leaf(location) ? null : name;
}

/** The status bar text for the result of an operation, or null when there is nothing to say. */
export function resultMessage(r: Pick<OpResult, "aborted" | "done" | "replaced">): string | null {
  if (r.aborted) return r.done ? "一部の項目は処理されませんでした" : "操作を中止しました";
  if (r.replaced) return "同じ名前があった項目は、元に戻す対象になりません";
  return null;
}
