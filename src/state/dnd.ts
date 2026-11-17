// Drop coordinator: what is dropped from Explorer, a browser or our own drag arrives through the
// "drag-drop" event of the window's drop target (src-tauri/src/droptarget/).
// Spec: docs/spec/fileops.md, docs/spec/tabs.md
//
// The hit-testing is split into pure functions (tested in dnd.test.ts) and a thin DOM/Tauri layer.

import { listen } from "@tauri-apps/api/event";
import { backend } from "../api/backend";
import { errorText } from "../model/input";
import { normPath, splitByParent } from "../model/paths";
import { setShown } from "../model/tabs";
import { setMessage } from "./message";
import { openDroppedFolders } from "./navigation";
import { setTabs } from "./tabActions";
import { openPopup, type PopupItem } from "./popup";
import { dropFiles, dropFilesAs, saveDropped } from "./fileActions";
import { getState } from "./store";

/** Position in physical pixels inside the webview. */
interface DragPosition {
  x: number;
  y: number;
}

/**
 * Payload of the "drag-drop" event. `saving`: the drag has no paths (an image or a link from a
 * browser); on drop its data is written to temporary files, and `paths` are those files.
 */
type DragDropPayload =
  | { type: "enter"; paths: string[]; position: DragPosition; saving: boolean }
  | { type: "over"; position: DragPosition }
  | {
      type: "drop";
      paths: string[];
      position: DragPosition;
      saving: boolean;
      /** Dragged with the right button: a menu asks what to do. */
      rightButton: boolean;
      error: string | null;
    }
  | { type: "leave" };

export const HOVER_SHOW_MS = 500;

/** The drop-related attributes of one element in the ancestor chain (nearest first). */
export interface DropAttrs {
  folder?: string | null;
  tab?: string | null;
  pane?: string | null;
}

export type DropTarget =
  | { kind: "folder"; location: string; index: number }
  | { kind: "tab"; tabId: string; location: string; index: number }
  | { kind: "pane"; tabId: string; location: string; index: number };

/**
 * Picks the drop target from the attributes of an element and its ancestors (nearest first):
 * the nearest folder item, else a tab, else a pane. `index` is the position in `chain` of the
 * element that matched (for highlighting). Tabs/panes without a known folder yield null.
 */
export function resolveTarget(
  chain: DropAttrs[],
  tabLocation: (tabId: string) => string | null,
  paneLocation: (tabId: string) => string | null,
): DropTarget | null {
  const folder = chain.findIndex((a) => a.folder);
  if (folder >= 0) return { kind: "folder", location: chain[folder].folder as string, index: folder };
  const tab = chain.findIndex((a) => a.tab);
  if (tab >= 0) {
    const tabId = chain[tab].tab as string;
    const location = tabLocation(tabId);
    return location ? { kind: "tab", tabId, location, index: tab } : null;
  }
  const pane = chain.findIndex((a) => a.pane);
  if (pane >= 0) {
    const tabId = chain[pane].pane as string;
    const location = paneLocation(tabId);
    return location ? { kind: "pane", tabId, location, index: pane } : null;
  }
  return null;
}

export function toCssPoint(pos: { x: number; y: number }, devicePixelRatio: number): { x: number; y: number } {
  const r = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { x: pos.x / r, y: pos.y / r };
}

/** True when an item is dropped onto itself. */
export function isSelfDrop(paths: string[], dest: string): boolean {
  const d = normPath(dest);
  return paths.some((p) => normPath(p) === d);
}

/**
 * True when dropping `paths` on `dest` would do nothing useful: onto one of the items itself,
 * or into the folder they are already in. Such targets are not highlighted.
 */
export function isNoopDrop(paths: string[], dest: string): boolean {
  if (!paths.length) return false;
  return isSelfDrop(paths, dest) || splitByParent(paths, dest).other.length === 0;
}

/**
 * The menu of a right-button drop of `paths` on `dest`. Moving is disabled when every item is
 * already in `dest`; copying there duplicates them.
 */
export function rightDropItems(
  paths: string[],
  dest: string,
  drop: (kind: "copy" | "move" | "link", paths: string[], dest: string) => unknown = dropFilesAs,
): PopupItem[] {
  const alreadyThere = splitByParent(paths, dest).other.length === 0;
  const choose = (kind: "copy" | "move" | "link") => () => void drop(kind, paths, dest);
  return [
    { text: "ここにコピー(_C)", onSelect: choose("copy") },
    { text: "ここに移動(_M)", disabled: alreadyThere, onSelect: choose("move") },
    { text: "ショートカットをここに作成(_S)", onSelect: choose("link") },
    { separator: true },
    { text: "キャンセル", onSelect: () => {} },
  ];
}

export interface HoverTimer {
  /** Reports the tab currently hovered (null = none). Fires `onFire(tabId)` once after `delayMs` of staying on it. */
  set(tabId: string | null): void;
  cancel(): void;
}

export function createHoverTimer(
  delayMs: number,
  onFire: (tabId: string) => void,
  timers: { set: (f: () => void, ms: number) => unknown; clear: (h: unknown) => void } = {
    set: (f, ms) => setTimeout(f, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
): HoverTimer {
  let current: string | null = null;
  let handle: unknown = null;
  const cancel = () => {
    if (handle !== null) timers.clear(handle);
    handle = null;
    current = null;
  };
  return {
    set(tabId) {
      if (tabId === current) return;
      cancel();
      if (tabId === null) return;
      current = tabId;
      handle = timers.set(() => {
        handle = null;
        onFire(tabId);
      }, delayMs);
    },
    cancel,
  };
}

// ---------------------------------------------------------------- DOM / Tauri layer

function attrsOf(el: Element): DropAttrs {
  return {
    folder: el.getAttribute("data-drop-folder"),
    tab: el.getAttribute("data-drop-tab"),
    pane: el.getAttribute("data-drop-pane"),
  };
}

function hitTest(pos: { x: number; y: number }): { target: DropTarget; element: Element } | null {
  const css = toCssPoint(pos, window.devicePixelRatio);
  const start = document.elementFromPoint(css.x, css.y);
  const els: Element[] = [];
  for (let el: Element | null = start; el; el = el.parentElement) els.push(el);
  const { tabs, panes } = getState();
  const target = resolveTarget(
    els.map(attrsOf),
    (id) => tabs.tabs.find((t) => t.id === id)?.location ?? null,
    (id) => panes[id]?.folder?.location ?? tabs.tabs.find((t) => t.id === id)?.location ?? null,
  );
  return target ? { target, element: els[target.index] } : null;
}

/**
 * The drop target highlight: one frame on top of everything, placed over the target element.
 * (A class on the target itself is hidden by its children, e.g. a pane under its list.)
 */
function dropOverlay(): HTMLElement {
  let el = document.getElementById("drop-overlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "drop-overlay";
    el.className = "drop-overlay";
    document.body.appendChild(el);
  }
  return el;
}

function showOverlay(target: Element | null) {
  const o = dropOverlay();
  if (!target) {
    o.style.display = "none";
    return;
  }
  const r = target.getBoundingClientRect();
  Object.assign(o.style, {
    display: "block",
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
}

/** Subscribes to drag & drop events once. Returns an unsubscribe function. */
export async function initDnd(): Promise<() => void> {
  // Paths of the current drag (only the enter event carries them).
  let dragged: string[] = [];
  const hover = createHoverTimer(HOVER_SHOW_MS, (tabId) => {
    setTabs((s) => setShown(s, [tabId], true));
  });
  const clear = () => {
    showOverlay(null);
    hover.cancel();
    dragged = [];
  };

  const unlisten = await listen<DragDropPayload>("drag-drop", (event) => {
    const p = event.payload;
    if (p.type === "leave") {
      clear();
      return;
    }
    if (p.type === "enter") dragged = p.paths;
    const hit = hitTest(p.position);
    if (p.type === "enter" || p.type === "over") {
      // Re-placed on every move: the list may scroll under the pointer.
      showOverlay(hit && !isNoopDrop(dragged, hit.target.location) ? hit.element : null);
      const tab = hit?.target.kind === "tab" ? hit.target : null;
      const hidden = tab && getState().tabs.tabs.find((t) => t.id === tab.tabId)?.shown === false;
      hover.set(tab && hidden ? tab.tabId : null);
      return;
    }
    // drop
    clear();
    if (p.error) setMessage(`ドロップしたものを保存できません: ${p.error}`);
    if (!p.paths.length) return;
    if (!hit) {
      // On a bar: folders open in tabs. Saved data (temporary files) has nowhere to go.
      if (!p.saving) void backend.keyState().then((mods) => openDroppedFolders(p.paths, mods));
      return;
    }
    const dest = hit.target.location;
    if (isSelfDrop(p.paths, dest)) return;
    if (p.rightButton && !p.saving) {
      // The Shell's own menu, so that drag-and-drop extensions (FastCopy, archivers) are in it.
      // Our menu is the fallback where the Shell has no drop target for the folder.
      backend.rightDrop(p.paths, dest, p.position.x, p.position.y).catch(() => {
        const at = toCssPoint(p.position, window.devicePixelRatio);
        openPopup(rightDropItems(p.paths, dest), at.x, at.y);
      });
      return;
    }
    void (async () => {
      try {
        if (p.saving) {
          await saveDropped(p.paths, dest);
          return;
        }
        const mods = await backend.keyState();
        await dropFiles(p.paths, dest, mods);
      } catch (e) {
        setMessage(errorText(e));
      }
    })();
  });

  return () => {
    unlisten();
    clear();
  };
}
