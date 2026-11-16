// Shared scroller for the details and thumbnail views: virtualisation, mouse and keyboard handling.
// Specs: docs/spec/listing.md「選択」「マウス」, docs/spec/fileops.md

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { backend } from "../../api/backend";
import type { Entry } from "../../api/types";
import type { Mods } from "../../model/navigation";
import { listKeyIsBound } from "../../commands/keys";
import { goUp, openEntries, setMessage } from "../../state/actions";
import { selectedLocations } from "../../state/fileActions";
import {
  clickItem,
  jumpToPrefix,
  moveCursor,
  ordered,
  prepareContext,
  selectedEntries,
  setSelection,
} from "../../state/selection";
import { getState, updatePane, type PaneState } from "../../state/store";
import { errorText, runMenuVerb } from "./menu";
import { marqueeHits, normalizeBox, revealScroll, sameSet, visibleRange, type Box, type ItemsRow, type Layout } from "./layout";
import { trackPointer } from "./pointer";

export interface ViewProps {
  id: string;
  pane: PaneState;
  current: boolean;
}

interface ListBaseProps extends ViewProps {
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
  renderItem: (e: Entry, col: number, row: ItemsRow) => ReactNode;
  /** Ctrl+wheel over the list: 1 = wheel up, -1 = down. Without it Ctrl+wheel only scrolls. */
  onCtrlWheel?: (dir: 1 | -1) => void;
}

const EDGE = 24;
/** Wheel delta of one mouse notch; touchpads send smaller deltas that add up to it. */
const WHEEL_NOTCH = 100;
const GROUP_HEIGHT_CLASS = "group-row";

const modsOf = (e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): Mods => ({
  ctrl: e.ctrlKey,
  shift: e.shiftKey,
  alt: e.altKey,
});

export function ListBase(props: ListBaseProps) {
  const { id, pane, current, className, headerHeight, header, contentWidth, itemHeight, layoutFor, itemBox, horizontalKeys, renderItem, onCtrlWheel } = props;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** A right-button drag is running or has just ended: its context menu event is ignored. */
  const rightDragging = useRef(false);
  const [vp, setVp] = useState({ top: 0, width: 0, height: 0 });
  const [marquee, setMarquee] = useState<Box | null>(null);
  const typeAhead = useRef({ text: "", at: 0 });

  const layout = useMemo(() => layoutFor(vp.width), [layoutFor, vp.width]);
  const latest = useRef({ layout, itemBox, headerHeight });
  useLayoutEffect(() => {
    latest.current = { layout, itemBox, headerHeight };
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
  const ctrlWheel = useRef(onCtrlWheel);
  useLayoutEffect(() => {
    ctrlWheel.current = onCtrlWheel;
  });
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const f = ctrlWheel.current;
      if (!f) return;
      acc += e.deltaY;
      while (Math.abs(acc) >= WHEEL_NOTCH) {
        const dir = acc < 0 ? 1 : -1;
        acc += dir * WHEEL_NOTCH;
        f(dir);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // New folder: back to the top. Cursor change: keep it visible.
  const folderLoc = pane.folder?.location;
  useEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [folderLoc]);

  const cursor = pane.cursor;
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

  // Focus the list of the current pane after navigation/loading.
  const loading = pane.loading;
  useEffect(() => {
    if (!current || loading || getState().dialog) return;
    const a = document.activeElement as HTMLElement | null;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return;
    scrollerRef.current?.focus({ preventScroll: true });
  }, [current, loading, folderLoc]);

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
    const base = additive ? new Set(getState().panes[id]?.selected) : new Set<string>();
    if (!additive) setSelection(id, []);
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
      if (!active && Math.hypot(cx - sx, cy - sy) < 4) return;
      active = true;
      const box = normalizeBox(sx, sy, cx, cy);
      setMarquee(box);
      const L = latest.current;
      const next = new Set([...base, ...marqueeHits(L.layout, L.itemBox, box)]);
      if (!sameSet(next, getState().panes[id]?.selected)) setSelection(id, [...next]);
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
      const speed = (d: number) => Math.min(40, 3 + Math.floor(d / 3));
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

  const startItemGesture = (e: React.PointerEvent, loc: string, collapse: boolean) => {
    const sx = e.clientX;
    const sy = e.clientY;
    const stop = trackPointer(
      (ev) => {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        stop();
        const locs = selectedLocations(id);
        backend
          .startDrag(locs.length ? locs : [loc])
          .catch((err) => setMessage(errorText(err)))
          .finally(() => setMarquee(null));
      },
      () => {
        if (collapse) clickItem(id, loc, { ctrl: false, shift: false });
      },
    );
  };

  // Right-button drag: the drop target shows the copy / move / shortcut menu. A right click that
  // does not move stays a click, and the context menu opens as usual.
  const startRightGesture = (e: React.PointerEvent, loc: string) => {
    const sx = e.clientX;
    const sy = e.clientY;
    const stop = trackPointer(
      (ev) => {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        stop();
        if (!getState().panes[id]?.selected.has(loc)) clickItem(id, loc, { ctrl: false, shift: false });
        const locs = selectedLocations(id);
        rightDragging.current = true;
        backend
          .startDrag(locs.length ? locs : [loc])
          .catch((err) => setMessage(errorText(err)))
          // The button is released inside the drag; a context menu event may still follow it.
          .finally(() => setTimeout(() => (rightDragging.current = false), 100));
      },
      () => {},
      2,
    );
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2 && !ignoreTarget(e)) {
      const loc = itemAt(e.target);
      if (loc) startRightGesture(e, loc);
      return;
    }
    if (e.button !== 0 || ignoreTarget(e)) return;
    const loc = itemAt(e.target);
    const additive = e.ctrlKey;
    if (loc) {
      const selected = getState().panes[id]?.selected.has(loc) ?? false;
      const collapse = selected && !e.ctrlKey && !e.shiftKey;
      if (!collapse) clickItem(id, loc, { ctrl: e.ctrlKey, shift: e.shiftKey });
      else updatePane(id, () => ({ cursor: loc }));
      // Dragging an unselected item with Ctrl toggles it off; only drag when it ends up selected.
      if (getState().panes[id]?.selected.has(loc)) startItemGesture(e, loc, collapse);
    } else {
      startMarquee(e, additive);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (e.button !== 0 || ignoreTarget(e)) return;
    const loc = itemAt(e.target);
    if (!loc) {
      void goUp(id, modsOf(e));
      return;
    }
    const p = getState().panes[id];
    if (!p) return;
    const sel = selectedEntries(p);
    const item = ordered(p).entries.find((x) => x.location === loc);
    void openEntries(id, sel.some((x) => x.location === loc) ? sel : item ? [item] : [], modsOf(e));
  };

  const onMouseDown = (e: React.MouseEvent) => {
    // Stop the WebView's middle-button autoscroll and back/forward handling.
    if (e.button === 1 || e.button === 3 || e.button === 4) e.preventDefault();
  };

  const onAuxClick = (e: React.MouseEvent) => {
    if (e.button !== 1 || ignoreTarget(e)) return;
    // Empty space goes up; a middle click on an item does nothing.
    if (!itemAt(e.target)) void goUp(id);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (rightDragging.current || ignoreTarget(e)) return;
    const folder = getState().panes[id]?.folder;
    if (!folder) return;
    const loc = itemAt(e.target);
    prepareContext(id, loc);
    const items = loc ? selectedLocations(id) : [];
    backend
      .showContextMenu(folder.location, items, e.clientX, e.clientY)
      .then((verb) => runMenuVerb(id, verb))
      .catch((err) => setMessage(errorText(err)));
  };

  // ------------------------------------------------------------ keyboard

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return;
    // A key with a binding belongs to the binding (keys.ts runs it); the built-in list keys stay out.
    if (listKeyIsBound(e.nativeEvent)) return;
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const p = getState().panes[id];
    if (!p) return;
    const cols = layout.columns;
    const bodyH = (scrollerRef.current?.clientHeight ?? 0) - headerHeight;
    const page = Math.max(1, Math.floor(bodyH / itemHeight) - 1) * cols;
    const mods = { ctrl: e.ctrlKey, shift: e.shiftKey };
    let delta: number | "home" | "end" | null = null;
    switch (e.key) {
      case "ArrowUp":
        delta = -cols;
        break;
      case "ArrowDown":
        delta = cols;
        break;
      case "ArrowLeft":
        if (horizontalKeys) delta = -1;
        break;
      case "ArrowRight":
        if (horizontalKeys) delta = 1;
        break;
      case "PageUp":
        delta = -page;
        break;
      case "PageDown":
        delta = page;
        break;
      case "Home":
        delta = "home";
        break;
      case "End":
        delta = "end";
        break;
    }
    if (delta !== null) {
      e.preventDefault();
      moveCursor(id, delta, mods);
      return;
    }
    if (e.key === "Enter" && !e.altKey) {
      e.preventDefault();
      const sel = selectedEntries(p);
      const cur = ordered(p).entries.find((x) => x.location === p.cursor);
      const targets = sel.length ? sel : cur ? [cur] : [];
      if (targets.length) void openEntries(id, targets, modsOf(e));
      return;
    }
    const ta = typeAhead.current;
    const typing = Date.now() - ta.at < 1000 && ta.text !== "";
    if (e.key === " " && !typing) {
      e.preventDefault();
      const loc = p.cursor;
      if (!loc) return;
      updatePane(id, (x) => {
        const selected = new Set(x.selected);
        if (selected.has(loc)) selected.delete(loc);
        else selected.add(loc);
        return { selected, anchor: loc };
      });
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      ta.text = (typing ? ta.text : "") + e.key;
      ta.at = Date.now();
      // Repeating one letter cycles through the items starting with it.
      const prefix = [...ta.text].every((c) => c === ta.text[0]) ? ta.text[0] : ta.text;
      const cur = ordered(p).entries.find((x) => x.location === p.cursor);
      if (prefix.length > 1 && cur?.name.toLowerCase().startsWith(prefix.toLowerCase())) return;
      jumpToPrefix(id, prefix);
    }
  };

  // ------------------------------------------------------------ render

  const widthStyle = contentWidth === undefined ? undefined : contentWidth;
  return (
    <div
      ref={scrollerRef}
      className={`list ${className ?? ""}`}
      data-pane-list=""
      data-pane-id={id}
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
              {row.entries.map((e, col) => renderItem(e, col, row))}
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
