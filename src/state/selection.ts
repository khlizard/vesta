// Selection and item order within a pane: applies the rules of model/selection.ts to the store.
// Spec: docs/spec/listing.md「選択」

import type { Entry } from "../api/types";
import {
  clickSelect,
  contextSelect,
  moveSelect,
  only,
  patternToRegExp,
  prefixTarget,
  toggleAtCursor,
  type CursorStep,
  type SelMods,
} from "../model/selection";
import { groupEntries, sortEntries, type Ordered } from "../model/sort";

export type { Ordered } from "../model/sort";
import { updatePane, type PaneState } from "./store";

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

/** Every location of the pane in display order. */
const order = (p: PaneState) => ordered(p).entries.map((e) => e.location);

export function selectedEntries(p: PaneState): Entry[] {
  return ordered(p).entries.filter((e) => p.selected.has(e.location));
}

/** Mouse click on an item. */
export function clickItem(id: string, location: string, mods: SelMods) {
  updatePane(id, (p) => clickSelect(p, order(p), location, mods));
}

/** Right-click: keep the selection if the item is in it, else select only it. */
export function prepareContext(id: string, location: string | null) {
  updatePane(id, (p) => contextSelect(p, location));
}

export function setSelection(id: string, locations: string[]) {
  updatePane(id, () => ({ selected: new Set(locations) }));
}

/** Moves the cursor to `location` without touching the selection. */
export function setCursor(id: string, location: string) {
  updatePane(id, () => ({ cursor: location }));
}

/** Space: toggles the item under the cursor. */
export function toggleCursorItem(id: string) {
  updatePane(id, toggleAtCursor);
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

export function selectPattern(id: string, pattern: string) {
  const re = patternToRegExp(pattern);
  updatePane(id, (p) => ({ selected: new Set(p.entries.filter((e) => re.test(e.name)).map((e) => e.location)) }));
}

/** Keyboard cursor movement (see `moveSelect`). */
export function moveCursor(id: string, step: CursorStep, mods: SelMods) {
  updatePane(id, (p) => moveSelect(p, order(p), step, mods));
}

/** Type-ahead: moves to the next item whose name starts with `prefix`. */
export function jumpToPrefix(id: string, prefix: string) {
  updatePane(id, (p) => {
    const target = prefixTarget(ordered(p).entries, p.cursor, prefix);
    return target ? only(target) : {};
  });
}
