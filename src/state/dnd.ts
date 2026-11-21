// Decisions about drops: what a point is over, which drops do nothing, what the right-button
// menu offers. The window's drop events themselves are handled in src/root/drop.ts.
// Spec: docs/spec/fileops.md, docs/spec/tabs.md

import { normPath, splitByParent } from "../model/paths";
import type { PopupItem } from "./popup";
import { dropFilesAs } from "./fileActions";

/** Position in physical pixels inside the webview. */
interface DragPosition {
  x: number;
  y: number;
}

/**
 * Payload of the "drag-drop" event. `saving`: the drag has no paths (an image or a link from a
 * browser); on drop its data is written to temporary files, and `paths` are those files.
 */
export type DragDropPayload =
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
  /** A program or a shortcut: it is handed what is dropped on it. */
  file?: string | null;
  tab?: string | null;
  pane?: string | null;
}

export type DropTarget =
  | { kind: "folder"; location: string; index: number }
  | { kind: "file"; location: string; index: number }
  | { kind: "tab"; tabId: string; location: string; index: number }
  | { kind: "pane"; tabId: string; location: string; index: number };

/**
 * Picks the drop target from the attributes of an element and its ancestors (nearest first):
 * the nearest folder item or (with `files`) program / shortcut item, else a tab, else a pane.
 * `index` is the position in `chain` of the element that matched (for highlighting). Tabs/panes
 * without a known folder yield null. `files` is false for a drag without paths (data from a
 * browser), which a program cannot be handed.
 */
export function resolveTarget(
  chain: DropAttrs[],
  tabLocation: (tabId: string) => string | null,
  paneLocation: (tabId: string) => string | null,
  files = true,
): DropTarget | null {
  const item = chain.findIndex((a) => a.folder || (files && a.file));
  if (item >= 0) {
    const { folder, file } = chain[item];
    return folder
      ? { kind: "folder", location: folder, index: item }
      : { kind: "file", location: file as string, index: item };
  }
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

/** Whether a drop of `paths` on `target` would do something, so that the target is worth highlighting. */
export function isUsefulDrop(paths: string[], target: DropTarget): boolean {
  // A program is handed the files wherever they are; only dropping it on itself is nothing.
  return target.kind === "file" ? !isSelfDrop(paths, target.location) : !isNoopDrop(paths, target.location);
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
