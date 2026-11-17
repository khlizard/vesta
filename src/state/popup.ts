// Popup menu model shared by the popup component and non-React callers (key bindings).
import { focusPane } from "./focus";
import { getState, setState } from "./store";
import type { MenuItem } from "../config/types";
import type { Mods } from "../model/navigation";

/** A menu item as shown in a popup: a configured item plus UI-only extensions. */
export interface PopupItem extends Omit<MenuItem, "children"> {
  children?: PopupItem[];
  /** Show `text` as is (no `_X` access key handling). */
  literal?: boolean;
  /** 16px icon URL (overrides `image`). */
  iconSrc?: string;
  /** Children loaded when the submenu is opened. */
  loadChildren?: () => Promise<PopupItem[]>;
  /** Overrides the check mark / disabled look otherwise derived from `command`. */
  checked?: boolean;
  disabled?: boolean;
  /** Levels to indent the label by (a folder under its ancestors). */
  indent?: number;
  /** Drawn in bold (the folder the pane is in, among its ancestors). */
  strong?: boolean;
  /** Link item whose `path` was not found: drawn greyed with a × in place of the icon. */
  missing?: boolean;
  /** Replaces `runItem` when the item is chosen. */
  onSelect?: (mods: Mods) => void;
  /** Right-click on the item, at this client point. */
  onContextMenu?: (at: { x: number; y: number }) => void;
}

export interface PopupRequest {
  items: PopupItem[];
  x: number;
  y: number;
  /** Who opened it (e.g. a link bar button), so a bar can switch menus on hover. */
  owner?: string;
  /** Opened with the mouse: no item is selected until the pointer or a key picks one. */
  byMouse?: boolean;
  /** Counts the popups opened so far: a new one replaces the menu on screen even at the same place. */
  seq: number;
}

/** Owner prefix of the popups opened from the menu bar. */
export const MENU_OWNER = "menu:";

let opened = 0;

/**
 * Opens a popup menu at client position (x, y). Replaces any open popup. The menu bar stops
 * being highlighted: the keys now belong to the menu.
 */
export function openPopup(items: PopupItem[], x: number, y: number, owner?: string, byMouse = false) {
  setState({ popup: { items, x, y, owner, byMouse, seq: ++opened }, menuBarHot: null });
}

/** Owner of the open popup, or null when none is open. */
export function popupOwner(): string | null {
  const p = getState().popup;
  return p ? (p.owner ?? "") : null;
}

/**
 * Whether hovering bar button `owner` should switch the open popup to that button's menu:
 * a menu of the same bar (`group`, e.g. "link:") is open, it is another button's, and the button has a menu.
 */
export function switchesOnHover(openOwner: string | null, owner: string, group: string, hasMenu: boolean): boolean {
  return hasMenu && openOwner !== null && openOwner.startsWith(group) && openOwner !== owner;
}

/** Closes the popup. The keyboard focus, which the menu had, goes back to the current pane. */
export function closePopup() {
  if (!getState().popup) return;
  setState({ popup: null });
  focusPane();
}

export function isSeparator(item: PopupItem): boolean {
  return (
    !!item.separator ||
    (!item.text &&
      !item.command &&
      !item.navigate &&
      !item.execute &&
      !item.path &&
      !item.children &&
      !item.loadChildren &&
      !item.onSelect)
  );
}

/**
 * Access-key character of a key press in an open popup (lower case), or null.
 * Ctrl/Shift/Alt may be held: they choose how a link opens (docs/spec/navigation.md).
 */
export function accessKeyPressed(e: { key: string; metaKey: boolean }): string | null {
  return e.key.length === 1 && !e.metaKey ? e.key.toLowerCase() : null;
}

