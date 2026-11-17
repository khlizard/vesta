// Key bindings (keyboard-form.xml / keyboard-folder.xml). Spec: docs/spec/config.md

import { openPopup } from "../components/popupBus";
import { useConfig } from "../config/store";
import type { KeyBinding } from "../config/types";
import { modsOf } from "../model/input";
import { getState } from "../state/store";
import { runItem } from "./items";

type KeyLike = Pick<KeyboardEvent, "code" | "key">;
type ModLike = Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "altKey" | "metaKey">;

const NAMED: Record<string, string> = {
  Backspace: "backspace",
  Tab: "tab",
  Enter: "return",
  NumpadEnter: "return",
  Escape: "escape",
  Space: "space",
  Delete: "delete",
  Insert: "insert",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
  ArrowLeft: "←",
  ArrowUp: "↑",
  ArrowRight: "→",
  ArrowDown: "↓",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Minus: "-",
  Equal: "=",
  Quote: "'",
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  IntlYen: "\\",
  IntlRo: "\\",
};

const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;

/** Key position (`code`) → the character that key types without Shift on the user's layout. */
export type LayoutMap = Pick<Map<string, string>, "get">;

/**
 * The symbol on a key of the current layout: on a Japanese keyboard the key at `BracketLeft`
 * is `@`, so a binding written `key="@"` must match it. Letters, digits and unknown keys
 * give "" (the position-based names apply).
 */
function layoutSymbol(code: string, layout: LayoutMap | null | undefined): string {
  const ch = layout?.get(code);
  if (!ch || ch.length !== 1 || /[a-z0-9\s]/i.test(ch)) return "";
  return ch === "¥" ? "\\" : ch;
}

let currentLayout: LayoutMap | null = null;

/** Reads the keyboard layout once at startup (WebView2 has `navigator.keyboard`); without it, US positions are used. */
export async function loadKeyboardLayout() {
  const kb = (navigator as { keyboard?: { getLayoutMap(): Promise<LayoutMap> } }).keyboard;
  currentLayout = kb ? await kb.getLayoutMap().catch(() => null) : null;
}

/** Avesta key name of a keyboard event; "" for modifier keys and unknown keys. */
export function keyName(e: KeyLike, layout: LayoutMap | null = currentLayout): string {
  const c = e.code;
  let m = /^Key([A-Z])$/.exec(c);
  if (m) return m[1];
  m = /^(?:Digit|Numpad)([0-9])$/.exec(c);
  if (m) return m[1];
  if (/^F([1-9]|1\d|2[0-4])$/.test(c)) return c;
  const symbol = layoutSymbol(c, layout);
  if (symbol) return symbol;
  if (c in NAMED) return NAMED[c];
  if (MODIFIER_CODES.test(c) || /^(Control|Shift|Alt|Meta)$/.test(e.key)) return "";
  return e.key.length === 1 ? e.key.toUpperCase() : "";
}

/** Modifier letters of an event, a subset of "CSAW" (Ctrl, Shift, Alt, Win). */
export function modifierString(e: ModLike): string {
  return (e.ctrlKey ? "C" : "") + (e.shiftKey ? "S" : "") + (e.altKey ? "A" : "") + (e.metaKey ? "W" : "");
}

const KEY_ALIAS: Record<string, string> = {
  left: "←",
  up: "↑",
  right: "→",
  down: "↓",
  enter: "return",
  esc: "escape",
  del: "delete",
  bs: "backspace",
  pgup: "pageup",
  pgdn: "pagedown",
};

function canonicalKey(key: string): string {
  const k = key.trim().toLowerCase();
  return KEY_ALIAS[k] ?? k;
}

const canonicalMods = (mods: string) => [...new Set(mods.toUpperCase())].sort().join("");

/** Finds the binding for `mods` (any order) and `key` (case-insensitive, arrow names equivalent). */
export function matchBinding(bindings: KeyBinding[], mods: string, key: string): KeyBinding | undefined {
  if (!key) return undefined;
  const m = canonicalMods(mods);
  const k = canonicalKey(key);
  return bindings.find((b) => canonicalMods(b.modifier) === m && canonicalKey(b.key) === k);
}

function popupPosition(): { x: number; y: number } {
  const list = document.activeElement?.closest("[data-pane-list]");
  const r = list?.getBoundingClientRect();
  if (r) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/**
 * Keys the WebView would act on by itself (reload, print, find, zoom, history, caret browsing...).
 * The window is an app, not a page: these must do nothing unless a binding uses them.
 */
export function isBrowserShortcut(mods: string, key: string): boolean {
  const m = canonicalMods(mods);
  const k = canonicalKey(key);
  if (m === "") return ["f3", "f5", "f7"].includes(k);
  if (m === "C") return ["r", "p", "f", "g", "j", "u", "s", "o", "f5", "=", "-", "+", "0", ";"].includes(k);
  if (m === "CS") return ["r", "g", "p", "s", "i", "j", "c", "=", "-", "+", ";"].includes(k);
  if (m === "S") return ["f3", "f5"].includes(k);
  if (m === "A") return ["←", "→", "home"].includes(k);
  return false;
}

/**
 * Capture-phase listener: cancels the WebView's page shortcuts wherever the focus is (text boxes
 * stop key events before the bubbling listeners see them). Bindings for these keys still run.
 */
export function blockBrowserShortcuts(e: KeyboardEvent) {
  if (isBrowserShortcut(modifierString(e), keyName(e))) e.preventDefault();
}

/** The binding a key event triggers: keyboard-folder.xml first when the focus is in a list. */
function bindingFor(e: KeyboardEvent, folderScope: boolean): KeyBinding | undefined {
  const key = keyName(e);
  if (!key) return undefined;
  const mods = modifierString(e);
  const { keyForm, keyFolder } = useConfig.getState();
  return (folderScope ? matchBinding(keyFolder, mods, key) : undefined) ?? matchBinding(keyForm, mods, key);
}

/**
 * True when a key pressed in a list has a binding. The list's built-in keys (arrows, Enter,
 * Space...) then stay out of the way, so a settings file can reassign any of them.
 */
export function listKeyIsBound(e: KeyboardEvent): boolean {
  return !getState().dialog && !!bindingFor(e, true);
}

export function handleGlobalKeyDown(e: KeyboardEvent) {
  if (getState().dialog) return;
  const t = e.target;
  const inText = t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  const folderScope = !!document.activeElement?.closest("[data-pane-list]");
  const binding = inText ? undefined : bindingFor(e, folderScope);
  if (!binding) return;
  e.preventDefault();
  const item = binding.item;
  if (item.children?.length) {
    const { x, y } = popupPosition();
    openPopup(item.children, x, y);
    return;
  }
  const m = modsOf(e);
  void runItem(item, m);
}
