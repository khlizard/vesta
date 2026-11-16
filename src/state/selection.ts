// Selection and item order within a pane. Spec: docs/spec/listing.md「選択」

import type { Entry } from "../api/types";
import { groupEntries, sortEntries, type GroupedRows } from "../model/sort";
import { getState, updatePane, type PaneState } from "./store";

export interface Ordered {
  /** Flat list in display order. */
  entries: Entry[];
  /** Groups when grouping is on, else null. */
  groups: GroupedRows[] | null;
}

const cache = new WeakMap<Entry[], { key: string; value: Ordered }>();

/** Entries in display order (sorted, grouped). Memoised per entries array and view. */
export function ordered(p: PaneState): Ordered {
  const { sortKey, sortDesc, grouping } = p.view;
  const key = `${sortKey}|${sortDesc}|${grouping}`;
  const hit = cache.get(p.entries);
  if (hit && hit.key === key) return hit.value;
  const sorted = sortEntries(p.entries, sortKey, sortDesc);
  let value: Ordered;
  if (grouping) {
    const groups = groupEntries(sorted, sortKey, sortDesc, Date.now());
    value = { entries: groups.flatMap((g) => g.entries), groups };
  } else {
    value = { entries: sorted, groups: null };
  }
  cache.set(p.entries, { key, value });
  return value;
}

export function selectedEntries(p: PaneState): Entry[] {
  return ordered(p).entries.filter((e) => p.selected.has(e.location));
}

/** Mouse click on an item. */
export function clickItem(id: string, location: string, mods: { ctrl: boolean; shift: boolean }) {
  updatePane(id, (p) => {
    if (mods.shift && p.anchor) {
      const list = ordered(p).entries;
      const a = list.findIndex((e) => e.location === p.anchor);
      const b = list.findIndex((e) => e.location === location);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = list.slice(lo, hi + 1).map((e) => e.location);
        const selected = mods.ctrl ? new Set([...p.selected, ...range]) : new Set(range);
        return { selected, cursor: location };
      }
    }
    if (mods.ctrl) {
      const selected = new Set(p.selected);
      if (selected.has(location)) selected.delete(location);
      else selected.add(location);
      return { selected, cursor: location, anchor: location };
    }
    return { selected: new Set([location]), cursor: location, anchor: location };
  });
}

/** Right-click: keep the selection if the item is in it, else select only it. */
export function prepareContext(id: string, location: string | null) {
  updatePane(id, (p) => {
    if (location === null) return { selected: new Set<string>() };
    if (p.selected.has(location)) return { cursor: location };
    return { selected: new Set([location]), cursor: location, anchor: location };
  });
}

export function setSelection(id: string, locations: string[]) {
  updatePane(id, () => ({ selected: new Set(locations) }));
}

export function selectAll(id: string) {
  updatePane(id, (p) => ({ selected: new Set(p.entries.map((e) => e.location)) }));
}

export function selectNone(id: string) {
  updatePane(id, () => ({ selected: new Set<string>() }));
}

export function selectReverse(id: string) {
  updatePane(id, (p) => ({
    selected: new Set(p.entries.filter((e) => !p.selected.has(e.location)).map((e) => e.location)),
  }));
}

/** Wildcard patterns separated by `;` (`*.txt;*.md`), case-insensitive. */
export function patternToRegExp(pattern: string): RegExp {
  const parts = pattern
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, "."));
  return new RegExp(`^(?:${parts.join("|") || "(?!)"})$`, "i");
}

export function selectPattern(id: string, pattern: string) {
  const re = patternToRegExp(pattern);
  updatePane(id, (p) => ({ selected: new Set(p.entries.filter((e) => re.test(e.name)).map((e) => e.location)) }));
}

/**
 * Keyboard cursor movement. `delta` in items (±1, ±columns, ±page), or "home"/"end".
 * Shift extends from the anchor, Ctrl moves only the cursor.
 */
export function moveCursor(
  id: string,
  delta: number | "home" | "end",
  mods: { ctrl: boolean; shift: boolean },
) {
  const p = getState().panes[id];
  if (!p) return;
  const list = ordered(p).entries;
  if (!list.length) return;
  const cur = list.findIndex((e) => e.location === p.cursor);
  let next: number;
  if (delta === "home") next = 0;
  else if (delta === "end") next = list.length - 1;
  else next = cur < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.min(Math.max(cur + delta, 0), list.length - 1);
  const loc = list[next].location;
  if (mods.ctrl && !mods.shift) {
    updatePane(id, () => ({ cursor: loc }));
  } else if (mods.shift) {
    const anchor = p.anchor ?? loc;
    const a = list.findIndex((e) => e.location === anchor);
    const [lo, hi] = a < next ? [a, next] : [next, a];
    updatePane(id, () => ({ cursor: loc, anchor, selected: new Set(list.slice(lo, hi + 1).map((e) => e.location)) }));
  } else {
    updatePane(id, () => ({ cursor: loc, anchor: loc, selected: new Set([loc]) }));
  }
}

/** Type-ahead: moves to the next item whose name starts with `prefix`. */
export function jumpToPrefix(id: string, prefix: string) {
  const p = getState().panes[id];
  if (!p) return;
  const list = ordered(p).entries;
  const cur = list.findIndex((e) => e.location === p.cursor);
  const lower = prefix.toLowerCase();
  for (let k = 1; k <= list.length; k++) {
    const e = list[(cur + k + list.length) % list.length];
    if (e.name.toLowerCase().startsWith(lower)) {
      updatePane(id, () => ({ cursor: e.location, anchor: e.location, selected: new Set([e.location]) }));
      return;
    }
  }
}
