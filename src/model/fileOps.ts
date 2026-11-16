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

/** The status bar text for the result of an operation, or null when there is nothing to say. */
export function resultMessage(r: Pick<OpResult, "aborted" | "done" | "replaced">): string | null {
  if (r.aborted) return r.done ? "一部の項目は処理されませんでした" : "操作を中止しました";
  if (r.replaced) return "同じ名前があった項目は、元に戻す対象になりません";
  return null;
}
