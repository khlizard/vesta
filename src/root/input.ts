// The window's key and pointer listeners: the only ones in the app. They turn DOM events into
// plain values and hand them to the root (dispatch.ts), which decides.

import { blockBrowserShortcuts } from "../commands/keys";
import { dispatch } from "./dispatch";
import { keyDown, keyUp, pointerDown, windowBlur, type KeyInput } from "./keys";

/**
 * Marks, for the listeners below: the open popup menu; a button that opens and closes its menu
 * itself (so a press on it is not a press outside the menu); a pane's list.
 */
export const POPUP_ATTR = "data-popup";
export const POPUP_ANCHOR_ATTR = "data-popup-anchor";
export const LIST_ATTR = "data-pane-list";

const isText = (el: Element | null) => el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);

function keyInput(e: KeyboardEvent): KeyInput {
  const target = e.target instanceof Element ? e.target : null;
  const list = target?.closest(`[${LIST_ATTR}]`) ?? null;
  const r = list?.getBoundingClientRect();
  return {
    key: e.key,
    code: e.code,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    repeat: e.repeat,
    inText: isText(target),
    inList: list !== null,
    at: r
      ? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
  };
}

/** Starts listening. Returns a function that stops. `blockPageKeys`: off in development, where F5 reloads. */
export function listenToWindow(blockPageKeys: boolean): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    // The window is an app, not a page: the WebView's own shortcuts do nothing (a key binding
    // for one of them still runs).
    if (blockPageKeys) blockBrowserShortcuts(e);
    if (keyDown(keyInput(e))) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    // Alt alone would otherwise open the system menu of the window.
    if (keyUp(e.key)) e.preventDefault();
  };
  const onPointerDown = (e: PointerEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    pointerDown(!!target?.closest(`[${POPUP_ATTR}]`), !!target?.closest(`[${POPUP_ANCHOR_ATTR}]`));
  };
  const onResize = () => dispatch({ type: "pane.arrange" });
  // The WebView's own context menu never shows; panes show the Explorer menu instead.
  const noMenu = (e: MouseEvent) => e.preventDefault();

  // Capture phase: the root sees a key before the element with the focus does.
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("blur", windowBlur);
  window.addEventListener("resize", onResize);
  window.addEventListener("contextmenu", noMenu);
  return () => {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("blur", windowBlur);
    window.removeEventListener("contextmenu", noMenu);
  };
}
