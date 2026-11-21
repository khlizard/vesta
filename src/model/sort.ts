// Sorting and grouping of entries. Spec: docs/spec/listing.md

import type { Entry, SyncState } from "../api/types";
import { formatAttributes } from "./format";

export type SortKey = "name" | "status" | "modified" | "type" | "size" | "created" | "accessed" | "attributes";

const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

export function compareNames(a: string, b: string): number {
  return collator.compare(a, b);
}

const SYNC_ORDER: Record<SyncState, number> = { pinned: 0, available: 1, onlineOnly: 2 };

function compareBy(key: SortKey, a: Entry, b: Entry): number {
  switch (key) {
    case "name":
      return 0;
    case "status":
      return (a.syncState ? SYNC_ORDER[a.syncState] : 9) - (b.syncState ? SYNC_ORDER[b.syncState] : 9);
    case "modified":
      return (a.modified ?? 0) - (b.modified ?? 0);
    case "type":
      return collator.compare(a.typeName, b.typeName);
    case "size":
      return (a.size ?? -1) - (b.size ?? -1);
    case "created":
      return (a.created ?? 0) - (b.created ?? 0);
    case "accessed":
      return (a.accessed ?? 0) - (b.accessed ?? 0);
    case "attributes":
      return collator.compare(formatAttributes(a.attributes), formatAttributes(b.attributes));
  }
}

/** Columns whose groups are date ranges (newest first in `order`). */
const DATE_KEYS: ReadonlySet<SortKey> = new Set(["modified", "created", "accessed"]);

/** Folders first, then by `key` (ties by name). `desc` reverses within folders and within files. */
export function sortEntries(entries: Entry[], key: SortKey, desc: boolean): Entry[] {
  const sign = desc ? -1 : 1;
  return [...entries].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    const c = compareBy(key, a, b) || collator.compare(a.name, b.name);
    return c * sign;
  });
}

export interface Group {
  key: string;
  label: string;
  /** Lower comes first in ascending order. */
  order: number;
}

const KANA_ROWS: [string, string][] = [
  ["あ", "ぉ"],
  ["か", "ご"],
  ["さ", "ぞ"],
  ["た", "ど"],
  ["な", "の"],
  ["は", "ぽ"],
  ["ま", "も"],
  ["ゃ", "よ"],
  ["ら", "ろ"],
  ["ゎ", "ん"],
];
const ROW_NAMES = ["あ行", "か行", "さ行", "た行", "な行", "は行", "ま行", "や行", "ら行", "わ行"];

function nameGroup(name: string): Group {
  const ch = name.trim().charAt(0);
  if (/[0-9０-９]/.test(ch)) return { key: "0-9", label: "0 - 9", order: 0 };
  if (/[a-zA-Zａ-ｚＡ-Ｚ]/.test(ch)) {
    const up = ch.normalize("NFKC").toUpperCase();
    return { key: up, label: up, order: 10 + up.charCodeAt(0) - 65 };
  }
  // Katakana → hiragana.
  const code = ch.charCodeAt(0);
  const hira = code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : ch;
  const row = KANA_ROWS.findIndex(([lo, hi]) => hira >= lo && hira <= hi);
  if (row >= 0) return { key: ROW_NAMES[row], label: ROW_NAMES[row], order: 100 + row };
  return { key: "other", label: "その他", order: 1000 };
}

const DAY = 86_400_000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dateGroup(ms: number | null, now: number): Group {
  if (ms === null) return { key: "unknown", label: "不明", order: 99 };
  const today = startOfDay(now);
  const n = new Date(now);
  const weekStart = today - n.getDay() * DAY; // weeks start on Sunday
  const monthStart = new Date(n.getFullYear(), n.getMonth(), 1).getTime();
  const lastMonthStart = new Date(n.getFullYear(), n.getMonth() - 1, 1).getTime();
  const yearStart = new Date(n.getFullYear(), 0, 1).getTime();
  const lastYearStart = new Date(n.getFullYear() - 1, 0, 1).getTime();
  const buckets: [number, string][] = [
    [today, "今日"],
    [today - DAY, "昨日"],
    [weekStart, "今週の前半"],
    [weekStart - 7 * DAY, "先週"],
    [monthStart, "今月の前半"],
    [lastMonthStart, "先月"],
    [yearStart, "今年の前半"],
    [lastYearStart, "昨年"],
  ];
  // Future dates count as today.
  if (ms >= today) return { key: "今日", label: "今日", order: 0 };
  // Buckets can be empty (e.g. on Sunday "今週の前半" starts today); skip those.
  let upper = today;
  for (let i = 1; i < buckets.length; i++) {
    const [start, label] = buckets[i];
    if (start >= upper) continue;
    if (ms >= start) return { key: label, label, order: i };
    upper = start;
  }
  return { key: "かなり前", label: "かなり前", order: 9 };
}

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

function sizeGroup(e: Entry): Group {
  if (e.isFolder || e.size === null) return { key: "folder", label: "フォルダー", order: 0 };
  const s = e.size;
  const table: [number, string][] = [
    [0, "空 (0 KB)"],
    [16 * KB, "極小 (0 - 16 KB)"],
    [MB, "小 (16 KB - 1 MB)"],
    [128 * MB, "中 (1 - 128 MB)"],
    [GB, "大 (128 MB - 1 GB)"],
    [4 * GB, "特大 (1 - 4 GB)"],
  ];
  for (let i = 0; i < table.length; i++) {
    const [max, label] = table[i];
    if (i === 0 ? s === 0 : s <= max) return { key: label, label, order: i + 1 };
  }
  return { key: "huge", label: "巨大 (> 4 GB)", order: 10 };
}

const SYNC_LABEL: Record<SyncState, string> = {
  pinned: "常に利用可能",
  available: "利用可能",
  onlineOnly: "オンラインのみ",
};

export function groupOf(e: Entry, key: SortKey, now: number): Group {
  switch (key) {
    case "name":
      return nameGroup(e.name);
    case "modified":
      return dateGroup(e.modified, now);
    case "type":
      return { key: e.typeName, label: e.typeName || "不明", order: 0 };
    case "size":
      return sizeGroup(e);
    case "status":
      return e.syncState
        ? { key: e.syncState, label: SYNC_LABEL[e.syncState], order: SYNC_ORDER[e.syncState] }
        : { key: "none", label: "なし", order: 9 };
    case "created":
      return dateGroup(e.created, now);
    case "accessed":
      return dateGroup(e.accessed, now);
    case "attributes": {
      const a = formatAttributes(e.attributes);
      return a ? { key: a, label: a, order: 0 } : { key: "none", label: "なし", order: 0 };
    }
  }
}

export interface GroupedRows {
  group: Group;
  entries: Entry[];
}

/** Groups already-sorted entries. Groups are ordered by `order` (or label for type/attributes), reversed when `desc`. */
export function groupEntries(sorted: Entry[], key: SortKey, desc: boolean, now: number): GroupedRows[] {
  const map = new Map<string, GroupedRows>();
  for (const e of sorted) {
    const g = groupOf(e, key, now);
    let row = map.get(g.key);
    if (!row) {
      row = { group: g, entries: [] };
      map.set(g.key, row);
    }
    row.entries.push(e);
  }
  const rows = [...map.values()];
  rows.sort((a, b) => {
    const c =
      key === "type" || key === "attributes"
        ? collator.compare(a.group.label, b.group.label)
        : a.group.order - b.group.order;
    // Dates: order 0 = newest; ascending date sort shows oldest first.
    const dateFlip = DATE_KEYS.has(key) ? -1 : 1;
    return c * dateFlip * (desc ? -1 : 1);
  });
  return rows;
}
