// What the window is doing right now, and what input is let through because of it.
// Spec: docs/spec/ui.md「モード」
//
// The mode is not stored: it is read off the few facts the store holds (an open dialog, an open
// popup, a field being edited...). Every decision about input goes through here, so that the
// answer to "may this key / command act now?" is given in one place.

/** A text field of a pane that is being edited. */
export interface Editing {
  paneId: string;
  field: "address" | "rename";
}

/** The facts the mode is read from. */
export interface ModeSource {
  /** A modal dialog is open. */
  dialog: boolean;
  /** Owner of the open popup menu ("" when it has none); null when no popup is open. */
  popupOwner: string | null;
  /** A Shell context menu or a drag started by us has the input. */
  native: boolean;
  editing: Editing | null;
  /** The menu bar is highlighted for keyboard use (Alt alone), without an open menu. */
  menuBarHot: boolean;
}

export type Mode =
  | { kind: "dialog" }
  | { kind: "popup"; owner: string }
  | { kind: "native" }
  | { kind: "edit"; paneId: string; field: Editing["field"] }
  | { kind: "menubar" }
  | { kind: "idle" };

/** The mode, by precedence: what is in front of everything else comes first. */
export function modeOf(s: ModeSource): Mode {
  if (s.dialog) return { kind: "dialog" };
  if (s.popupOwner !== null) return { kind: "popup", owner: s.popupOwner };
  if (s.native) return { kind: "native" };
  if (s.editing) return { kind: "edit", paneId: s.editing.paneId, field: s.editing.field };
  if (s.menuBarHot) return { kind: "menubar" };
  return { kind: "idle" };
}

/** Who gets a key press. */
export type KeyRoute =
  /** The dialog and its fields; nothing behind it. */
  | "dialog"
  /** Navigation of the open popup menu. */
  | "popup"
  /** Navigation of the highlighted menu bar. */
  | "menubar"
  /** The text field with the focus; key bindings stay out. */
  | "text"
  /** Key bindings, then the built-in keys of the list. */
  | "bindings"
  /** Nobody: the input belongs to something outside the page. */
  | "none";

/**
 * Where a key press goes. `inText` says whether the focus is in a text field (the address bar,
 * a rename box): typing there must never run a key binding.
 */
export function routeKey(mode: Mode, inText: boolean): KeyRoute {
  switch (mode.kind) {
    case "dialog":
      return "dialog";
    case "popup":
      return "popup";
    case "native":
      return "none";
    case "edit":
      return "text";
    case "menubar":
      return "menubar";
    case "idle":
      return inText ? "text" : "bindings";
  }
}

/** Whether a command asked for from a bar, a menu or a key may start in this mode. */
export function commandsAllowed(mode: Mode): boolean {
  // A popup closes before its item runs, so commands only ever arrive in the modes behind it.
  return mode.kind !== "dialog" && mode.kind !== "native";
}

/** Whether pressing Alt alone acts on the menu bar in this mode. */
export function altAloneAllowed(mode: Mode): boolean {
  return mode.kind !== "dialog" && mode.kind !== "native";
}

// ---------------------------------------------------------------- Alt alone

/** Tracks one press of Alt, to tell "Alt alone" from Alt used with another key or the mouse. */
export interface AltPress {
  down: boolean;
  /** Another key or a mouse button was used since Alt went down. */
  used: boolean;
}

export const NO_ALT: AltPress = { down: false, used: false };

export type AltEvent =
  | { type: "keydown"; key: string; repeat: boolean }
  | { type: "keyup"; key: string }
  | { type: "pointerdown" };

const MODIFIER_KEYS = ["Control", "Shift", "Meta"];

/**
 * Feeds one input event to the tracker. `alone` is true on the release of an Alt that was
 * pressed and released with nothing else in between (holding it down repeats, which is fine).
 */
export function trackAlt(press: AltPress, e: AltEvent): { press: AltPress; alone: boolean } {
  if (e.type === "pointerdown") return { press: { ...press, used: true }, alone: false };
  if (e.type === "keydown") {
    if (e.key === "Alt") return { press: e.repeat ? press : { down: true, used: false }, alone: false };
    // Ctrl/Shift/Win going down with Alt held is still a chord in the making, not a use yet.
    if (MODIFIER_KEYS.includes(e.key)) return { press, alone: false };
    return { press: { ...press, used: true }, alone: false };
  }
  if (e.key !== "Alt") return { press, alone: false };
  return { press: NO_ALT, alone: press.down && !press.used };
}
