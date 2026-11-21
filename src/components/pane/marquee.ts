// The marquee (rubber band) of a list: follows the pointer until the button comes up, scrolls
// the list while the pointer is near or past an edge, and reports the items under the box.

import { dragStarted } from "../../model/input";
import { marqueeHits, normalizeBox, sameSet, type Box, type Layout } from "../../model/layout";
import { edgeScroll } from "../../model/selection";
import { trackPointer } from "./pointer";

/** Distance from an edge of the list inside which the marquee starts to scroll it. */
const EDGE = 24;

interface Marquee {
  /** The element the items are laid out in (box coordinates are relative to it). */
  body: HTMLElement;
  scroller: () => HTMLElement | null;
  /** Items that stay selected whatever the box covers (an additive marquee). */
  base: Set<string>;
  /** The list as it is now: it changes while the marquee scrolls and selects. */
  latest: () => {
    layout: Layout;
    itemBox: (col: number) => { left: number; width: number };
    headerHeight: number;
    selected: Set<string>;
  };
  /** Draws the box (null: the marquee has ended). */
  show: (box: Box | null) => void;
  /** The selection the box asks for, when it differs from the present one. */
  select: (items: string[]) => void;
}

/** Starts a marquee at the pointer position of `e`. */
export function trackMarquee(e: { clientX: number; clientY: number }, m: Marquee) {
  const r0 = m.body.getBoundingClientRect();
  const sx = e.clientX - r0.left;
  const sy = e.clientY - r0.top;
  let px = e.clientX;
  let py = e.clientY;
  let dirty = false;
  let active = false;
  let raf = 0;

  const update = () => {
    const r = m.body.getBoundingClientRect();
    const cx = px - r.left;
    const cy = py - r.top;
    if (!active && !dragStarted(cx - sx, cy - sy)) return;
    active = true;
    const box = normalizeBox(sx, sy, cx, cy);
    m.show(box);
    const L = m.latest();
    const next = new Set([...m.base, ...marqueeHits(L.layout, L.itemBox, box)]);
    if (!sameSet(next, L.selected)) m.select([...next]);
  };

  const tick = () => {
    raf = requestAnimationFrame(tick);
    const el = m.scroller();
    if (!el) return;
    const sr = el.getBoundingClientRect();
    const view = {
      left: sr.left,
      top: sr.top + m.latest().headerHeight,
      width: el.clientWidth,
      height: el.clientHeight - m.latest().headerHeight,
    };
    const { dx, dy } = edgeScroll(px, py, view, EDGE);
    if (dx || dy) {
      const before = el.scrollTop + el.scrollLeft * 1e4;
      el.scrollTop += dy;
      el.scrollLeft += dx;
      if (el.scrollTop + el.scrollLeft * 1e4 !== before) dirty = true;
    }
    if (dirty) {
      dirty = false;
      update();
    }
  };
  raf = requestAnimationFrame(tick);

  trackPointer(
    (ev) => {
      px = ev.clientX;
      py = ev.clientY;
      dirty = true;
    },
    () => {
      cancelAnimationFrame(raf);
      m.show(null);
    },
  );
}
