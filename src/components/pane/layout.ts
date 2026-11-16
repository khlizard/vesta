// Pure layout helpers shared by the details and thumbnail views.

import type { Entry } from "../../api/types";
import type { Ordered } from "../../state/selection";

export interface GroupRow {
  kind: "group";
  key: string;
  label: string;
  count: number;
  top: number;
  height: number;
}

export interface ItemsRow {
  kind: "items";
  entries: Entry[];
  /** Index of the first entry in the flat display order. */
  start: number;
  top: number;
  height: number;
}

export type Row = GroupRow | ItemsRow;

export interface Layout {
  rows: Row[];
  height: number;
  columns: number;
  /** Item location -> index into `rows`. */
  rowOf: Map<string, number>;
}

/** Splits the display order into rows of `columns` items (1 for details), with group header rows. */
export function buildLayout(
  ord: Pick<Ordered, "entries" | "groups">,
  columns: number,
  itemHeight: number,
  groupHeight: number,
): Layout {
  const cols = Math.max(1, Math.floor(columns));
  const rows: Row[] = [];
  const rowOf = new Map<string, number>();
  let top = 0;
  let start = 0;
  const addItems = (entries: Entry[]) => {
    for (let i = 0; i < entries.length; i += cols) {
      const slice = entries.slice(i, i + cols);
      rows.push({ kind: "items", entries: slice, start, top, height: itemHeight });
      for (const e of slice) rowOf.set(e.location, rows.length - 1);
      start += slice.length;
      top += itemHeight;
    }
  };
  if (ord.groups) {
    for (const g of ord.groups) {
      rows.push({ kind: "group", key: g.group.key, label: g.group.label, count: g.entries.length, top, height: groupHeight });
      top += groupHeight;
      addItems(g.entries);
    }
  } else {
    addItems(ord.entries);
  }
  return { rows, height: top, columns: cols, rowOf };
}

/** Indices [from, to) of rows intersecting the vertical range [y1, y2). */
export function visibleRange(rows: Row[], y1: number, y2: number): [number, number] {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].top + rows[mid].height > y1) hi = mid;
    else lo = mid + 1;
  }
  const from = lo;
  hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].top >= y2) hi = mid;
    else lo = mid + 1;
  }
  return [from, lo];
}

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function normalizeBox(ax: number, ay: number, bx: number, by: number): Box {
  return { x1: Math.min(ax, bx), y1: Math.min(ay, by), x2: Math.max(ax, bx), y2: Math.max(ay, by) };
}

/** Locations of the items whose rectangle intersects `box` (content coordinates). */
export function marqueeHits(
  layout: Layout,
  itemBox: (col: number) => { left: number; width: number },
  box: Box,
): string[] {
  const [from, to] = visibleRange(layout.rows, box.y1, box.y2);
  const hits: string[] = [];
  for (let r = from; r < to; r++) {
    const row = layout.rows[r];
    if (row.kind !== "items") continue;
    row.entries.forEach((e, col) => {
      const b = itemBox(col);
      if (b.left < box.x2 && b.left + b.width > box.x1) hits.push(e.location);
    });
  }
  return hits;
}

/** New scrollTop that makes [top, top + height) visible in a view of `viewHeight`; unchanged if already visible. */
export function revealScroll(top: number, height: number, scrollTop: number, viewHeight: number): number {
  if (top < scrollTop) return top;
  if (top + height > scrollTop + viewHeight) return Math.max(0, top + height - viewHeight);
  return scrollTop;
}

export function sameSet(a: Set<string>, b: Set<string> | undefined): boolean {
  if (!b || a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
