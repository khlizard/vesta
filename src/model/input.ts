// Small helpers for reading user input and reporting errors, shared by every layer.

import type { Mods } from "./navigation";

/** Pointer travel (px) before a press becomes a drag. */
export const DRAG_THRESHOLD = 4;

/** Whether the pointer has moved far enough from where it was pressed to count as a drag. */
export function dragStarted(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD;
}

/** Modifier state of a mouse/keyboard event as navigation modifiers. */
export function modsOf(e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): Mods {
  return { ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey };
}

/**
 * A key press that belongs to a Japanese conversion (Enter to confirm, arrows, Esc): it must not
 * act on the field. `keyCode` 229 covers the press that ends the conversion, where `isComposing`
 * is already false in some WebView versions.
 */
export function isImeKey(e: { nativeEvent: { isComposing: boolean }; keyCode: number }): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

/** The text of something caught: the backend rejects with strings, the rest throws Errors. */
export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

/** Joins the class names that are set. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
