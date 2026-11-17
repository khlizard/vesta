// Everything a view can tell the root: what happened, never what to do about it.
// The root (dispatch.ts) decides, from the mode the window is in (docs/spec/ui.md「モード」).

import type { MenuItem } from "../config/types";
import type { Mods } from "../model/navigation";
import type { SelMods } from "../model/selection";
import type { SortKey } from "../model/sort";
import type { PopupItem } from "../state/popup";

/** A point in client px. */
export interface Point {
  x: number;
  y: number;
}

/** How the list with the focus is laid out, for the keys that move the cursor. */
export interface Grid {
  columns: number;
  /** Items a page key moves over. */
  page: number;
  /** Left/Right move the cursor (items sit side by side). */
  horizontal: boolean;
}

export type UiEvent =
  // ---------------------------------------------------------------- bars and menus
  /** A bar button or a menu-like item was chosen. `middle`: with the middle button. */
  | { type: "item"; item: MenuItem; mods: Mods; middle?: boolean }
  /** A bar button asks for its drop-down menu, to open at `at`. */
  | { type: "menu.open"; items: PopupItem[]; at: Point; owner?: string }
  /** An item of the open popup menu was chosen. */
  | { type: "menu.select"; item: PopupItem; mods: Mods }
  /** An item of the open popup menu was right-clicked. */
  | { type: "menu.context"; item: PopupItem; at: Point }
  /** The open popup asks to be closed (Escape at its top level). */
  | { type: "menu.close" }
  /** Left/Right at the top level of the open popup: the neighbouring menu of the menu bar. */
  | { type: "menu.sibling"; dir: 1 | -1 }
  /** The menu bar says where its items are (`at[i]`: left and bottom edge of item i). */
  | { type: "menubar.layout"; at: Point[] }
  | { type: "menubar.press"; index: number }
  | { type: "menubar.hover"; index: number }
  /** A link bar button was clicked (`middle`: with the middle button). `at`: where its menu opens. */
  | { type: "link.click"; index: number; mods: Mods; middle?: boolean; at: Point }
  | { type: "link.hover"; index: number; at: Point }
  | { type: "link.context"; index: number; at: Point }

  // ---------------------------------------------------------------- tabs
  | { type: "tab.click"; id: string; mods: Mods }
  | { type: "tab.doubleClick"; id: string }
  | { type: "tab.middleClick"; id: string }
  | { type: "tab.wheel"; dir: 1 | -1 }
  /** Tab `id` is being dragged and is now past the middle of tab `over`. */
  | { type: "tab.dragOver"; id: string; over: string }
  | { type: "tab.context"; id: string; at: Point }

  // ---------------------------------------------------------------- panes
  /** A pointer went down somewhere in pane `id`. */
  | { type: "pane.press"; id: string }
  /** The borders between panes were dragged: width fractions by pane id. */
  | { type: "pane.widths"; widths: Record<string, number> }
  /** The border between the two rows was dragged: height fraction of the upper row. */
  | { type: "pane.rowSplit"; split: number }
  /** The window was resized (sent by the root's own listener): the panes are arranged evenly again. */
  | { type: "pane.arrange" }
  /** The list of pane `id` now has this client width (px). */
  | { type: "pane.listWidth"; id: string; width: number | null }
  /** A back / forward mouse button was released over pane `id`. */
  | { type: "pane.history"; id: string; dir: "back" | "forward" }

  // ---------------------------------------------------------------- address bar
  /** The address field of pane `id` got or lost the focus. */
  | { type: "address.editing"; id: string; on: boolean }
  /** The text in the address field of pane `id` was edited: folder names to complete it are looked up. */
  | { type: "address.input"; id: string; text: string }
  /** Enter in the address field, or a suggestion was picked. */
  | { type: "address.commit"; id: string; text: string; mods: Mods }
  /** Escape or Tab in the address field. */
  | { type: "address.cancel"; id: string }
  /**
   * The drop-down of the folder's ancestors is asked for, to open at `at`. `toggle`: by its
   * button, which closes it when it is open (the wheel and the Down key only open it).
   */
  | { type: "address.dropdown"; id: string; at: Point; toggle: boolean }
  /** The folder icon is being dragged. */
  | { type: "address.dragIcon"; id: string }
  | { type: "address.contextIcon"; id: string; at: Point }

  // ---------------------------------------------------------------- list
  /** Left button down on an item. */
  | { type: "list.press"; id: string; item: string; mods: SelMods }
  /** The button pressed on `item` was released without a drag. */
  | { type: "list.release"; id: string; item: string }
  /** Left button down on empty space (a marquee may follow). `additive`: Ctrl is held. */
  | { type: "list.pressEmpty"; id: string; additive: boolean }
  /** The marquee now covers these items (with the selection it started from, when additive). */
  | { type: "list.marquee"; id: string; items: string[] }
  /** The pointer has travelled far enough from a press on `item` to be a drag. */
  | { type: "list.drag"; id: string; item: string; button: "left" | "right" }
  | { type: "list.doubleClick"; id: string; item: string | null; mods: Mods }
  | { type: "list.middleClick"; id: string; item: string | null }
  | { type: "list.context"; id: string; item: string | null; at: Point }
  /** A key the list got (no key binding took it). */
  | { type: "list.key"; id: string; key: string; mods: Mods; grid: Grid }
  /** Ctrl+wheel over a list. 1 = wheel up. */
  | { type: "list.zoom"; id: string; dir: 1 | -1 }
  | { type: "list.sort"; id: string; key: SortKey }
  | { type: "list.contextHeader"; at: Point }
  /** A column was dropped at index `to` of the columns shown in pane `id`. */
  | { type: "list.moveColumn"; id: string; key: SortKey; to: number }
  | { type: "list.columnWidth"; key: SortKey; width: number }
  /** Double-click on a column border: fit the column to what pane `id` lists. */
  | { type: "list.fitColumn"; id: string; key: SortKey }
  /**
   * The rename box of `item` was confirmed with `name`, or given up (`name` null). `refocus`:
   * ended with a key, so the list takes the focus back; ended by losing the focus, it has
   * already gone where the user put it.
   */
  | { type: "rename.end"; id: string; item: string; name: string | null; refocus: boolean }

  // ---------------------------------------------------------------- dialogs
  | { type: "dialog.confirm"; text: string; mods: Mods }
  | { type: "dialog.close" };
