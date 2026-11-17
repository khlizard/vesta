// Per-folder view settings with parent inheritance and expiry.
// Spec: docs/spec/listing.md「フォルダごとの表示設定」

import { backend } from "../api/backend";
import { saveLater } from "../model/pacing";
import { normPath } from "../model/paths";
import { DEFAULT_VIEW, type ViewSettings } from "./store";

/** Saved settings over the defaults, keeping only known fields (older files also stored column widths). */
function viewOf(saved: Partial<ViewSettings>): ViewSettings {
  const v = { ...DEFAULT_VIEW, ...saved };
  return { mode: v.mode, sortKey: v.sortKey, sortDesc: v.sortDesc, grouping: v.grouping, showHidden: v.showHidden };
}

const EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;

interface Saved {
  view: ViewSettings;
  used: number;
}

let views = new Map<string, Saved>();

/** Ancestor keys of a location, nearest first (file-system paths only). */
export function ancestorKeys(location: string): string[] {
  const k = normPath(location);
  const out = [k];
  let i = k.lastIndexOf("\\");
  while (i > 0) {
    const parent = k.slice(0, i);
    // Stop at "\\server" for UNC paths.
    if (parent === "\\" || /^\\\\[^\\]*$/.test(parent)) break;
    out.push(parent);
    i = parent.lastIndexOf("\\");
  }
  return out;
}

const TOUCH_AFTER_MS = 24 * 60 * 60 * 1000;

export function getViewFor(location: string, now = Date.now()): ViewSettings {
  for (const k of ancestorKeys(location)) {
    const v = views.get(k);
    if (v) {
      // Using a folder keeps its settings alive: they expire 7 days after the last use, not
      // 7 days after the last change. Once a day is enough to note.
      if (now - v.used > TOUCH_AFTER_MS) {
        v.used = now;
        save.soon();
      }
      return viewOf(v.view);
    }
  }
  return DEFAULT_VIEW;
}

export function rememberView(location: string, view: ViewSettings) {
  views.set(normPath(location), { view, used: Date.now() });
  save.soon();
}

export async function loadViews() {
  const raw = await backend.readState("folders").catch(() => null);
  if (!raw) return;
  try {
    const obj = JSON.parse(raw) as Record<string, Saved>;
    const now = Date.now();
    views = new Map(
      Object.entries(obj).filter(
        ([, v]) => v && typeof v === "object" && typeof v.used === "number" && v.view && now - v.used < EXPIRE_MS,
      ),
    );
  } catch {
    views = new Map();
  }
}

const save = saveLater(2000, () =>
  backend.writeState("folders", JSON.stringify(Object.fromEntries(views))).catch(() => {}),
);

/** Writes folders.json now (before the window closes). */
export const saveViews = save.now;
