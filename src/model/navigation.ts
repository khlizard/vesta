// How a folder is opened. Spec: docs/spec/navigation.md

export type Action =
  | "goto"
  | "gotoAlways"
  | "open"
  | "append"
  | "reserve"
  | "replace"
  | "switch"
  | "cancel";

export interface Mods {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export const NO_MODS: Mods = { ctrl: false, shift: false, alt: false };

/** Moving inside a pane (double-click, Enter, back/forward/up, address bar). */
export function inPaneAction(mods: Mods, locked: boolean): Action {
  const { ctrl, shift, alt } = mods;
  if (shift && alt && !ctrl) return "switch";
  if (ctrl && alt && !shift) return "gotoAlways";
  if (ctrl && shift) return locked ? "append" : "replace";
  if (shift) return "reserve";
  if (ctrl) return locked ? "goto" : "append";
  return locked ? "append" : "goto";
}

/** Opening from outside a pane (link bar, File.Open, MRU, drop, command line). */
export function externalAction(mods: Mods): Action {
  const { ctrl, shift, alt } = mods;
  if (shift && alt && !ctrl) return "switch";
  if (ctrl && shift) return "replace";
  if (shift) return "reserve";
  if (ctrl) return "append";
  return "open";
}
