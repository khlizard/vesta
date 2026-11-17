// Details view columns: which are shown and in what order.
// Spec: docs/spec/listing.md「詳細の列」「列のカスタマイズ」

import type { Entry } from "../api/types";
import { formatAttributes, formatDate, formatSizeColumn } from "./format";
import type { SortKey } from "./sort";

/** The text of each column's cell (`status` shows an icon instead). */
export const cellText: Record<SortKey, (e: Entry) => string> = {
  name: (e) => e.name,
  status: () => "",
  modified: (e) => formatDate(e.modified),
  type: (e) => e.typeName,
  size: (e) => (e.isFolder ? "" : formatSizeColumn(e.size)),
  created: (e) => formatDate(e.created),
  accessed: (e) => formatDate(e.accessed),
  attributes: (e) => formatAttributes(e.attributes),
};

export const COLUMN_LABEL: Record<SortKey, string> = {
  name: "名前",
  status: "状態",
  modified: "更新日時",
  type: "種類",
  size: "サイズ",
  created: "作成日時",
  accessed: "アクセス日時",
  attributes: "属性",
};

/** Every column, in the order the column menu lists them. */
export const ALL_COLUMNS: readonly SortKey[] = [
  "name",
  "status",
  "modified",
  "type",
  "size",
  "created",
  "accessed",
  "attributes",
];

export const DEFAULT_COLUMNS: readonly SortKey[] = ["name", "status", "modified", "type", "size"];

export const RIGHT_ALIGNED: ReadonlySet<SortKey> = new Set(["size"]);

const KNOWN: ReadonlySet<string> = new Set(ALL_COLUMNS);

/** Configured columns from config.json: known keys only, no duplicates, `name` first. */
export function normalizeColumns(raw: unknown): SortKey[] {
  if (!Array.isArray(raw)) return [...DEFAULT_COLUMNS];
  const seen = new Set<SortKey>();
  for (const k of raw) {
    if (typeof k === "string" && KNOWN.has(k) && k !== "name") seen.add(k as SortKey);
  }
  return ["name", ...seen];
}

/** Columns to draw: the configured ones, with `status` only under a sync root. */
export function visibleColumns(columns: readonly SortKey[], syncRoot: boolean): SortKey[] {
  return columns.filter((c) => c !== "status" || syncRoot);
}

/** Shows or hides `key`. A shown column goes to the right end. `name` cannot be hidden. */
export function toggleColumn(columns: readonly SortKey[], key: SortKey): SortKey[] {
  if (key === "name") return [...columns];
  return columns.includes(key) ? columns.filter((c) => c !== key) : [...columns, key];
}

/**
 * Moves `key` so that it sits before the column at `toIndex` of the current list
 * (`columns.length` = right end). Nothing goes left of `name`.
 */
export function moveColumn(columns: readonly SortKey[], key: SortKey, toIndex: number): SortKey[] {
  const from = columns.indexOf(key);
  if (key === "name" || from < 0) return [...columns];
  const rest = columns.filter((c) => c !== key);
  let at = toIndex > from ? toIndex - 1 : toIndex;
  at = Math.max(1, Math.min(rest.length, at));
  rest.splice(at, 0, key);
  return rest;
}

/**
 * Like `moveColumn`, with `toIndex` counted in the drawn columns (`shown`, which may lack `status`).
 */
export function moveShownColumn(
  columns: readonly SortKey[],
  shown: readonly SortKey[],
  key: SortKey,
  toIndex: number,
): SortKey[] {
  const target = shown[toIndex];
  return moveColumn(columns, key, target ? columns.indexOf(target) : columns.length);
}

/**
 * Insertion index (0..widths.length) for a drag at offset `x` from the left edge of the header:
 * before the first column whose middle is right of `x`.
 */
export function dropIndex(widths: readonly number[], x: number): number {
  let left = 0;
  for (let i = 0; i < widths.length; i++) {
    if (x < left + widths[i] / 2) return i;
    left += widths[i];
  }
  return widths.length;
}
