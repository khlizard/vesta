// Window-level pointer tracking for gestures that must survive leaving the element.

/**
 * Calls `move` for pointer moves and `up` once when the button is released. Returns a stop function.
 * `buttonMask` is the held button as in `PointerEvent.buttons` (1 = primary, 2 = secondary).
 */
export function trackPointer(
  move: (e: PointerEvent) => void,
  up: (e: PointerEvent) => void,
  buttonMask = 1,
): () => void {
  const onMove = (e: PointerEvent) => {
    if (!(e.buttons & buttonMask)) {
      stop();
      up(e);
      return;
    }
    move(e);
  };
  const onUp = (e: PointerEvent) => {
    stop();
    up(e);
  };
  function stop() {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onUp, true);
  }
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
  return stop;
}
