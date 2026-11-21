// Keys and pointer presses anywhere in the window (input.ts sends them here), looked at in the
// light of the mode. Spec: docs/spec/ui.md「モード」

import { runItem } from "../commands/items";
import { bindingFor } from "../commands/keys";
import { parseCommand } from "../commands/registry";
import { modsOf } from "../model/input";
import { barItemFor, menuBarKey } from "../model/menu";
import { altAloneAllowed, NO_ALT, routeKey, trackAlt, type AltPress } from "../model/mode";
import { closeDialog } from "../state/dialogs";
import { setOption } from "../state/options";
import { closePopup, openPopup } from "../state/popup";
import { getState, setState } from "../state/store";
import type { Point } from "./events";
import { barAccessKeys, openMenuBar } from "./menus";
import { attempt, mode } from "./run";

// ---------------------------------------------------------------- window input

/** A key press as the root needs it (input.ts fills it in from the DOM event). */
export interface KeyInput {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  /** The focus is in a text field. */
  inText: boolean;
  /** The focus is in a pane's list (keyboard-folder.xml applies). */
  inList: boolean;
  /** Where a menu bound to the key opens: the middle of the list with the focus, or of the window. */
  at: Point;
}

let alt: AltPress = NO_ALT;

/** A key went down anywhere in the window. True when the root has dealt with it (nothing else should). */
export function keyDown(k: KeyInput): boolean {
  alt = trackAlt(alt, { type: "keydown", key: k.key, repeat: k.repeat }).press;
  const m = mode();

  // Alt+letter opens that menu of the menu bar, from wherever the focus is.
  if (k.altKey && !k.ctrlKey && altAloneAllowed(m) && getState().options.MenuVisible) {
    const i = barItemFor(barAccessKeys(), k.key, false);
    if (i >= 0) {
      openMenuBar(i, true);
      return true;
    }
  }

  switch (routeKey(m, k.inText)) {
    case "dialog":
      // The only dialog without an OK button is closed by Enter as well.
      if (k.key === "Escape" || (k.key === "Enter" && getState().dialog?.kind === "about")) {
        closeDialog();
        return true;
      }
      return false;
    case "menubar": {
      const hot = getState().menuBarHot ?? 0;
      const r = menuBarKey(hot, barAccessKeys(), k.key, k.ctrlKey);
      if (!r) return false;
      if ("hot" in r) setState({ menuBarHot: r.hot });
      else if ("open" in r) openMenuBar(r.open, true);
      else setState({ menuBarHot: null });
      return true;
    }
    case "bindings": {
      const binding = bindingFor(k, k.inList);
      if (!binding) return false;
      const item = binding.item;
      if (item.children?.length) openPopup(item.children, k.at.x, k.at.y);
      else attempt(runItem(item, modsOf(k), k.repeat));
      return true;
    }
    case "text": {
      // The field has the keys. One binding still runs while a name is being edited: the rename
      // command itself, which then changes the part of the name that is selected.
      if (m.kind !== "edit" || m.field !== "rename") return false;
      const item = bindingFor(k, true)?.item;
      if (!item?.command || parseCommand(item.command).name !== "Current.Rename") return false;
      attempt(runItem(item, modsOf(k), k.repeat));
      return true;
    }
    default:
      // "popup": the menu with the focus handles its keys. "none": Windows does.
      return false;
  }
}

/** A key came up. True when it was Alt pressed alone and the root acted on it. */
export function keyUp(key: string): boolean {
  const r = trackAlt(alt, { type: "keyup", key });
  alt = r.press;
  if (!r.alone || !altAloneAllowed(mode())) return false;
  const s = getState();
  if (!s.options.MenuVisible) {
    // A hidden menu bar could otherwise only be brought back by editing config.json.
    attempt(setOption("MenuVisible", true));
  } else if (s.popup) {
    closePopup();
  } else {
    setState({ menuBarHot: s.menuBarHot === null ? 0 : null });
  }
  return true;
}

/**
 * A pointer button went down anywhere in the window. `inPopup`: on the open popup menu;
 * `onAnchor`: on a button that opens and closes its menu itself (a menu bar item, the ▼ of an
 * address bar).
 */
export function pointerDown(inPopup: boolean, onAnchor: boolean) {
  alt = trackAlt(alt, { type: "pointerdown" }).press;
  const s = getState();
  if (s.menuBarHot !== null) setState({ menuBarHot: null });
  if (s.popup && !inPopup && !onAnchor) closePopup();
}

/** The window lost the focus: an open menu would be left hanging over other windows. */
export function windowBlur() {
  alt = NO_ALT;
  closePopup();
  if (getState().menuBarHot !== null) setState({ menuBarHot: null });
}
