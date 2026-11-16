// Tab model as pure functions. Spec: docs/spec/tabs.md
//
// Invariants kept by `normalize`:
// - if there are tabs, at least one is shown
// - `currentId` is a shown tab (or null when there are no tabs)

import type { Action } from "./navigation";

export type InsertPosition = "head" | "tail" | "prev" | "next";

export interface Tab {
  id: string;
  location: string;
  displayName: string;
  fsPath: string | null;
  shown: boolean;
  locked: boolean;
  back: string[];
  forward: string[];
}

export interface TabsState {
  tabs: Tab[];
  currentId: string | null;
}

export const EMPTY_TABS: TabsState = { tabs: [], currentId: null };

const indexOf = (s: TabsState, id: string | null) => s.tabs.findIndex((t) => t.id === id);

export function currentTab(s: TabsState): Tab | null {
  return s.tabs.find((t) => t.id === s.currentId) ?? null;
}

export function shownTabs(s: TabsState): Tab[] {
  return s.tabs.filter((t) => t.shown);
}

/** Restores the invariants. `preferIndex` is where to look for a new current tab. */
export function normalize(s: TabsState, preferIndex = 0): TabsState {
  if (s.tabs.length === 0) return EMPTY_TABS;
  let tabs = s.tabs;
  if (!tabs.some((t) => t.shown)) {
    const i = Math.min(Math.max(preferIndex, 0), tabs.length - 1);
    tabs = tabs.map((t, j) => (j === i ? { ...t, shown: true } : t));
  }
  const cur = tabs.find((t) => t.id === s.currentId);
  if (cur && cur.shown) return { tabs, currentId: cur.id };
  // Next shown tab at or after preferIndex, then before it.
  const start = Math.min(Math.max(preferIndex, 0), tabs.length - 1);
  const after = tabs.slice(start).find((t) => t.shown);
  const before = [...tabs.slice(0, start)].reverse().find((t) => t.shown);
  return { tabs, currentId: (after ?? before)!.id };
}

function update(s: TabsState, id: string, f: (t: Tab) => Tab): TabsState {
  return { ...s, tabs: s.tabs.map((t) => (t.id === id ? f(t) : t)) };
}

/** Plain click: show only this tab and make it current. */
export function clickTab(s: TabsState, id: string): TabsState {
  if (indexOf(s, id) < 0) return s;
  return { tabs: s.tabs.map((t) => ({ ...t, shown: t.id === id })), currentId: id };
}

/** Ctrl+click: toggle shown. Showing makes it current. The last shown tab stays shown. */
export function toggleShown(s: TabsState, id: string): TabsState {
  const i = indexOf(s, id);
  if (i < 0) return s;
  const t = s.tabs[i];
  if (!t.shown) return { ...update(s, id, (x) => ({ ...x, shown: true })), currentId: id };
  if (shownTabs(s).length <= 1) return s;
  return normalize(update(s, id, (x) => ({ ...x, shown: false })), i);
}

/** Show or hide a set of tabs (`X.Show(true|false|toggle)`). */
export function setShown(s: TabsState, ids: string[], show: boolean | "toggle"): TabsState {
  const set = new Set(ids);
  const firstIndex = s.tabs.findIndex((t) => set.has(t.id));
  let next: TabsState = {
    ...s,
    tabs: s.tabs.map((t) => (set.has(t.id) ? { ...t, shown: show === "toggle" ? !t.shown : show } : t)),
  };
  if (!next.tabs.some((t) => t.shown)) {
    // Hiding everything is refused for the current tab.
    next = update(next, s.currentId ?? "", (t) => ({ ...t, shown: true }));
  }
  return normalize(next, Math.max(firstIndex, 0));
}

/** Double-click: ensure shown and toggle the navigate lock. */
export function toggleLock(s: TabsState, id: string): TabsState {
  if (indexOf(s, id) < 0) return s;
  return normalize(update(s, id, (t) => ({ ...t, shown: true, locked: !t.locked })));
}

export function setLock(s: TabsState, id: string, locked: boolean): TabsState {
  return update(s, id, (t) => ({ ...t, locked }));
}

/** Make `id` current, showing it if needed (`Tab[n].Focus`). */
export function focusTab(s: TabsState, id: string): TabsState {
  if (indexOf(s, id) < 0) return s;
  return { ...update(s, id, (t) => ({ ...t, shown: true })), currentId: id };
}

/** Moves the current tab among shown tabs (`Tab.Next` / `Tab.Prev`). */
export function cycleCurrent(s: TabsState, dir: 1 | -1): TabsState {
  const shown = shownTabs(s);
  if (shown.length === 0) return s;
  const i = shown.findIndex((t) => t.id === s.currentId);
  const j = (i + dir + shown.length) % shown.length;
  return { ...s, currentId: shown[j].id };
}

export type CloseTarget = "current" | "all" | "left" | "right" | "shown" | "hidden" | "others" | "duplicate";

/** Ids selected by a close/show target relative to the current tab. */
export function targetIds(s: TabsState, target: CloseTarget): string[] {
  const ci = indexOf(s, s.currentId);
  switch (target) {
    case "current":
      return s.currentId ? [s.currentId] : [];
    case "all":
      return s.tabs.map((t) => t.id);
    case "left":
      return ci < 0 ? [] : s.tabs.slice(0, ci).map((t) => t.id);
    case "right":
      return ci < 0 ? [] : s.tabs.slice(ci + 1).map((t) => t.id);
    case "shown":
      return s.tabs.filter((t) => t.shown).map((t) => t.id);
    case "hidden":
      return s.tabs.filter((t) => !t.shown).map((t) => t.id);
    case "others":
      return s.tabs.filter((t) => t.id !== s.currentId).map((t) => t.id);
    case "duplicate": {
      const seen = new Set<string>();
      const dups: string[] = [];
      for (const t of s.tabs) {
        const k = t.location.toLowerCase();
        if (seen.has(k)) dups.push(t.id);
        else seen.add(k);
      }
      return dups;
    }
  }
}

/** Closes tabs. Locked tabs are kept unless `lockClose`. Returns the closed tabs (for the MRU). */
export function closeTabs(
  s: TabsState,
  ids: string[],
  lockClose: boolean,
): { state: TabsState; closed: Tab[] } {
  const set = new Set(ids);
  const closed = s.tabs.filter((t) => set.has(t.id) && (lockClose || !t.locked));
  if (closed.length === 0) return { state: s, closed };
  const closedIds = new Set(closed.map((t) => t.id));
  const ci = indexOf(s, s.currentId);
  const removedBefore = s.tabs.slice(0, Math.max(ci, 0)).filter((t) => closedIds.has(t.id)).length;
  const tabs = s.tabs.filter((t) => !closedIds.has(t.id));
  return { state: normalize({ tabs, currentId: s.currentId }, ci - removedBefore), closed };
}

export function insertIndex(s: TabsState, position: InsertPosition): number {
  const ci = indexOf(s, s.currentId);
  switch (position) {
    case "head":
      return 0;
    case "tail":
      return s.tabs.length;
    case "prev":
      return ci < 0 ? 0 : ci;
    case "next":
      return ci < 0 ? s.tabs.length : ci + 1;
  }
}

/**
 * Adds `tab` (state of `shown`/`locked` ignored) according to a new-tab action.
 * `goto` / `gotoAlways` / `cancel` are not new-tab actions and leave the state unchanged.
 */
export function addTab(s: TabsState, tab: Tab, action: Action, position: InsertPosition): TabsState {
  const i = insertIndex(s, position);
  const fresh: Tab = { ...tab, shown: false, locked: false };
  const tabs = [...s.tabs.slice(0, i), fresh, ...s.tabs.slice(i)];
  const base: TabsState = { tabs, currentId: s.currentId };
  switch (action) {
    case "open":
      return clickTab(base, fresh.id);
    case "append": {
      const next = update(base, fresh.id, (t) => ({ ...t, shown: true }));
      return normalize(next.currentId ? next : { ...next, currentId: fresh.id });
    }
    case "reserve":
      return normalize(base, i);
    case "switch":
      return focusTab(base, fresh.id);
    case "replace": {
      let next = focusTab(base, fresh.id);
      if (s.currentId) next = update(next, s.currentId, (t) => ({ ...t, shown: false, locked: false }));
      return normalize(next, i);
    }
    default:
      return s;
  }
}

/** Moves tab `id` to index `to` (index in the array after removal). */
export function moveTab(s: TabsState, id: string, to: number): TabsState {
  const i = indexOf(s, id);
  if (i < 0) return s;
  const tabs = [...s.tabs];
  const [t] = tabs.splice(i, 1);
  tabs.splice(Math.min(Math.max(to, 0), tabs.length), 0, t);
  return { ...s, tabs };
}

/** Wheel over the tab bar. */
export function wheelTabs(s: TabsState, dir: 1 | -1): TabsState {
  const n = s.tabs.length;
  if (n < 2) return s;
  const shown = shownTabs(s);
  const ci = indexOf(s, s.currentId);
  if (shown.length <= 1) {
    return clickTab(s, s.tabs[(ci + dir + n) % n].id);
  }
  // Swap the current pane with the next unlocked hidden tab in that direction.
  for (let k = 1; k < n; k++) {
    const cand = s.tabs[(ci + dir * k + n * k) % n];
    if (!cand.shown && !cand.locked) {
      const cur = s.currentId!;
      const tabs = s.tabs.map((t) =>
        t.id === cur ? { ...t, shown: false } : t.id === cand.id ? { ...t, shown: true } : t,
      );
      return { tabs, currentId: cand.id };
    }
  }
  return s;
}

/** Navigates tab `id` to a new folder, pushing history. */
export function navigateTab(
  s: TabsState,
  id: string,
  folder: { location: string; displayName: string; fsPath: string | null },
): TabsState {
  return update(s, id, (t) =>
    t.location === folder.location
      ? { ...t, ...folder }
      : { ...t, ...folder, back: [...t.back, t.location].slice(-100), forward: [] },
  );
}

/** Sets the folder a tab stands for without touching its history (a restored tab that resolved late). */
export function renameTab(
  s: TabsState,
  id: string,
  folder: { location: string; displayName: string; fsPath: string | null },
): TabsState {
  return update(s, id, (t) => ({ ...t, ...folder }));
}
/** Moves along the history. Returns the target location or null. */
export function historyTarget(t: Tab, dir: "back" | "forward"): string | null {
  const list = dir === "back" ? t.back : t.forward;
  return list.length ? list[list.length - 1] : null;
}

/** Applies a back/forward move to a tab after the target folder was loaded. */
export function applyHistory(
  s: TabsState,
  id: string,
  dir: "back" | "forward",
  folder: { location: string; displayName: string; fsPath: string | null },
): TabsState {
  return update(s, id, (t) => {
    if (dir === "back") {
      return { ...t, ...folder, back: t.back.slice(0, -1), forward: [...t.forward, t.location] };
    }
    return { ...t, ...folder, forward: t.forward.slice(0, -1), back: [...t.back, t.location] };
  });
}
