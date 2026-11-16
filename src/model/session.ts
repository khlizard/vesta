// The shape of var/session.json. Spec: docs/spec/ui.md「ウィンドウ」, docs/spec/config.md

import type { WindowPlacement } from "../api/types";
import type { TabsState } from "./tabs";

export interface SessionTab {
  location: string;
  shown: boolean;
  locked: boolean;
}

export interface Session {
  tabs: SessionTab[];
  current: number;
  mru: string[];
  /** Position, size and maximized state of the window; absent in files written before it was saved. */
  window?: WindowPlacement;
}

/** What to write: the tabs, the closed-folder list and (when known) where the window is. */
export function buildSession(tabs: TabsState, mru: string[], window: WindowPlacement | null): Session {
  const session: Session = {
    tabs: tabs.tabs.map((t) => ({ location: t.location, shown: t.shown, locked: t.locked })),
    current: tabs.tabs.findIndex((t) => t.id === tabs.currentId),
    mru,
  };
  if (window) session.window = window;
  return session;
}

const isPlacement = (w: unknown): w is WindowPlacement => {
  if (typeof w !== "object" || w === null) return false;
  const p = w as Record<string, unknown>;
  return (
    ["x", "y", "width", "height"].every((k) => Number.isFinite(p[k])) && typeof p.maximized === "boolean"
  );
};

/** One saved tab, or nothing when the entry is not usable (a hand-edited or damaged file). */
function toTab(v: unknown): SessionTab[] {
  if (typeof v !== "object" || v === null) return [];
  const t = v as Record<string, unknown>;
  if (typeof t.location !== "string" || !t.location) return [];
  return [{ location: t.location, shown: t.shown === true, locked: t.locked === true }];
}
/** Reads session.json; null when it is not usable. Missing parts become empty, bad entries are dropped. */
export function parseSession(raw: string): Session | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Partial<Session>;
  const session: Session = {
    tabs: Array.isArray(o.tabs) ? o.tabs.flatMap(toTab) : [],
    current: typeof o.current === "number" ? o.current : 0,
    mru: Array.isArray(o.mru) ? o.mru.filter((m): m is string => typeof m === "string" && m !== "") : [],
  };
  if (isPlacement(o.window)) session.window = o.window;
  return session;
}
