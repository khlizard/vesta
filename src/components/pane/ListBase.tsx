// Shared scroller for the details and thumbnail views: virtualisation, and the mouse and keys
// of the list, told to the root as they happen.
// Specs: docs/spec/listing.md「選択」「マウス」, docs/spec/fileops.md

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { dragStarted, modsOf } from "../../model/input";
import { edgeScrollSpeed, pageStep } from "../../model/selection";
import type { Entry, ListModel } from "../../presenters/list";
import { dispatch, isListKey } from "../../root/dispatch";
import { LIST_ATTR } from "../../root/input";
import { marqueeHits, normalizeBox, revealScroll, sameSet, visibleRange, type Box, type Layout } from "./layout";
import { trackPointer } from "./pointer";

export interface ViewProps {
  id: string;
}

interface ListBaseProps extends ViewProps {
  /** What the list shows (presenters/list.ts). */
  view: ListModel;
  className?: string;
  headerHeight: number;
  header?: ReactNode;
  /** Width of the content when it can exceed the pane (details); undefined = fill. */
  contentWidth?: number;
  /** Row height of item rows (for PageUp/PageDown). */
  itemHeight: number;
  layoutFor: (clientWidth: number) => Layout;
  /** Horizontal extent of the item in column `col` of its row, for marquee hit-testing. */
  itemBox: (col: number) => { left: number; width: number };
  /** Left/Right move the cursor (thumbnail view). */
  horizontalKeys: boolean;
  renderItem: (e: Entry, col: number) => ReactNode;
}

const EDGE = 24;
/** Wheel delta of one mouse notch; touchpads send smaller deltas that add up to it. */
const WHEEL_NOTCH = 100;
const GROUP_HEIGHT_CLASS = "group-row";
const LIST_MARK = { [LIST_ATTR]: "" };

export function ListBase(props: ListBaseProps) {
  const { id, view, className, headerHeight, header, contentWidth, itemHeight, layoutFor, itemBox, horizontalKeys, renderItem } = props;
  const { selected, cursor, folder, loading, current, focusSeq, wantsFocus } = view;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ top: 0, width: 0, height: 0 });
  const [marquee, setMarquee] = useState<Box | null>(null);

  const layout = useMemo(() => layoutFor(vp.width), [layoutFor, vp.width]);
  const latest = useRef({ layout, itemBox, headerHeight, selected, wantsFocus });
  useLayoutEffect(() => {
    latest.current = { layout, itemBox, headerHeight, selected, wantsFocus };
  });

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      setVp((v) => (v.width === width && v.height === height ? v : { ...v, width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ctrl+wheel: a non-passive listener so the page neither zooms nor scrolls.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      acc += e.deltaY;
      while (Math.abs(acc) >= WHEEL_NOTCH) {
        const dir = acc < 0 ? 1 : -1;
        acc += dir * WHEEL_NOTCH;
        dispatch({ type: "list.zoom", id, dir });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [id]);

  // New folder: back to the top. Cursor change: keep it visible.
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [folder]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !cursor) return;
    const L = latest.current;
    const ri = L.layout.rowOf.get(cursor);
    if (ri === undefined) return;
    const row = L.layout.rows[ri];
    const next = revealScroll(row.top, row.height, el.scrollTop, el.clientHeight - L.headerHeight);
    if (next !== el.scrollTop) el.scrollTop = next;
  }, [cursor]);

  /** Takes the keyboard focus, unless something is being typed somewhere. */
  const takeFocus = useCallback(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return;
    scrollerRef.current?.focus({ preventScroll: true });
  }, []);

  // Focus the list of the current pane after navigation/loading (whether it may is the presenter's call).
  useEffect(() => {
    if (latest.current.wantsFocus) takeFocus();
  }, [current, loading, folder, takeFocus]);

  // The root asks for the focus (a menu or dialog closed, the address bar was left, a rename
  // ended): it is taken wherever it is now, a text field included.
  useEffect(() => {
    if (focusSeq) scrollerRef.current?.focus({ preventScroll: true });
  }, [focusSeq]);

  const [from, to] = visibleRange(layout.rows, vp.top - 120, vp.top + vp.height + 120);

  // ------------------------------------------------------------ helpers

  const itemAt = (target: EventTarget | null): string | null =>
    (target as HTMLElement | null)?.closest?.<HTMLElement>("[data-item]")?.dataset.item ?? null;

  const ignoreTarget = (e: { target: EventTarget | null; clientX: number; clientY: number }): boolean => {
    const t = e.target as HTMLElement | null;
    if (!t || t.closest("[data-header], input")) return true;
    const el = scrollerRef.current;
    if (el && t === el) {
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left + el.clientWidth || e.clientY >= r.top + el.clientHeight) return true; // scrollbar
    }
    return false;
  };

  // ------------------------------------------------------------ mouse

  const startMarquee = (e: React.PointerEvent, additive: boolean) => {
    const body = bodyRef.current;
    if (!body) return;
    // What was selected at the press stays selected under an additive marquee.
    const base = additive ? new Set(latest.current.selected) : new Set<string>();
    const r0 = body.getBoundingClientRect();
    const sx = e.clientX - r0.left;
    const sy = e.clientY - r0.top;
    let px = e.clientX;
    let py = e.clientY;
    let dirty = false;
    let active = false;
    let raf = 0;

    const update = () => {
      const r = body.getBoundingClientRect();
      const cx = px - r.left;
      const cy = py - r.top;
      if (!active && !dragStarted(cx - sx, cy - sy)) return;
      active = true;
      const box = normalizeBox(sx, sy, cx, cy);
      setMarquee(box);
      const L = latest.current;
      const next = new Set([...base, ...marqueeHits(L.layout, L.itemBox, box)]);
      if (!sameSet(next, L.selected)) dispatch({ type: "list.marquee", id, items: [...next] });
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = scrollerRef.current;
      if (!el) return;
      const sr = el.getBoundingClientRect();
      const top = sr.top + latest.current.headerHeight + EDGE;
      const bottom = sr.top + el.clientHeight - EDGE;
      const left = sr.left + EDGE;
      const right = sr.left + el.clientWidth - EDGE;
      const speed = edgeScrollSpeed;
      let dy = 0;
      let dx = 0;
      if (py < top) dy = -speed(top - py);
      else if (py > bottom) dy = speed(py - bottom);
      if (px < left) dx = -speed(left - px);
      else if (px > right) dx = speed(px - right);
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
        setMarquee(null);
      },
    );
  };

  // A press on an item becomes a drag once the pointer has travelled far enough; a right-button
  // drag ends with the copy / move / shortcut menu of the drop target. A press that does not
  // move stays a click (the right button's then opens the context menu as usual).
  const startItemGesture = (e: React.PointerEvent, item: string, button: "left" | "right") => {
    const sx = e.clientX;
    const sy = e.clientY;
    const stop = trackPointer(
      (ev) => {
        if (!dragStarted(ev.clientX - sx, ev.clientY - sy)) return;
        stop();
        dispatch({ type: "list.drag", id, item, button });
      },
      () => {
        if (button === "left") dispatch({ type: "list.release", id, item });
      },
      button === "left" ? 1 : 2,
    );
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2 && !ignoreTarget(e)) {
      const item = itemAt(e.target);
      if (item) startItemGesture(e, item, "right");
      return;
    }
    if (e.button !== 0 || ignoreTarget(e)) return;
    const item = itemAt(e.target);
    if (item) {
      dispatch({ type: "list.press", id, item, mods: { ctrl: e.ctrlKey, shift: e.shiftKey } });
      startItemGesture(e, item, "left");
    } else {
      dispatch({ type: "list.pressEmpty", id, additive: e.ctrlKey });
      startMarquee(e, e.ctrlKey);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (e.button !== 0 || ignoreTarget(e)) return;
    dispatch({ type: "list.doubleClick", id, item: itemAt(e.target), mods: modsOf(e) });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    // Stop the WebView's middle-button autoscroll and back/forward handling.
    if (e.button === 1 || e.button === 3 || e.button === 4) e.preventDefault();
  };

  const onAuxClick = (e: React.MouseEvent) => {
    if (e.button !== 1 || ignoreTarget(e)) return;
    dispatch({ type: "list.middleClick", id, item: itemAt(e.target) });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // The header and the rename box have their own; the scroll bars have none.
    if (ignoreTarget(e)) return;
    dispatch({ type: "list.context", id, item: itemAt(e.target), at: { x: e.clientX, y: e.clientY } });
  };

  // ------------------------------------------------------------ keyboard

  // A key with a binding never gets here: the root takes it first (root/input.ts).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const columns = layout.columns;
    const bodyH = (scrollerRef.current?.clientHeight ?? 0) - headerHeight;
    const grid = { columns, page: pageStep(bodyH, itemHeight, columns), horizontal: horizontalKeys };
    const mods = modsOf(e);
    if (!isListKey(e.key, mods, grid)) return;
    e.preventDefault();
    dispatch({ type: "list.key", id, key: e.key, mods, grid });
  };

  // ------------------------------------------------------------ render

  const widthStyle = contentWidth === undefined ? undefined : contentWidth;
  return (
    <div
      ref={scrollerRef}
      className={`list ${className ?? ""}`}
      {...LIST_MARK}
      tabIndex={0}
      onScroll={(e) => {
        const top = e.currentTarget.scrollTop;
        setVp((v) => (v.top === top ? v : { ...v, top }));
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
      onAuxClick={onAuxClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      {header}
      <div ref={bodyRef} className="list-body" style={{ height: layout.height, width: widthStyle }}>
        {layout.rows.slice(from, to).map((row) =>
          row.kind === "group" ? (
            <div key={`g:${row.key}`} className={GROUP_HEIGHT_CLASS} style={{ top: row.top, height: row.height, width: widthStyle }}>
              <span>
                {row.label} ({row.count})
              </span>
            </div>
          ) : (
            <div key={row.entries[0].location} className="list-row" style={{ top: row.top, height: row.height, width: widthStyle }}>
              {row.entries.map((e, col) => renderItem(e, col))}
            </div>
          ),
        )}
        {marquee && (
          <div
            className="marquee"
            style={{ left: marquee.x1, top: marquee.y1, width: marquee.x2 - marquee.x1, height: marquee.y2 - marquee.y1 }}
          />
        )}
      </div>
    </div>
  );
}
