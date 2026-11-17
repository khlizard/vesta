// Arranges the shown tabs' panes side by side, in one or two rows. Spec: docs/spec/tabs.md「ペインの配置」

import { Fragment, useEffect, useMemo, useRef } from "react";
import { focusTab, shownTabs } from "../model/tabs";
import { setTabs } from "../state/actions";
import { initDnd } from "../state/dnd";
import { getState, setState, useStore } from "../state/store";
import { Pane } from "./Pane";
import { resizePair, resolveFractions, splitRows } from "./pane/arrange";
import "../styles/pane.css";

const SPLITTER = 4;
const MIN_PANE_PX = 40;
const MIN_ROW_PX = 60;

/** Follows a splitter drag until the button is released. */
function trackDrag(e: React.PointerEvent<HTMLDivElement>, move: (ev: PointerEvent) => void) {
  e.preventDefault();
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const end = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", end);
    el.removeEventListener("pointercancel", end);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

export function PaneArea() {
  const tabs = useStore((s) => s.tabs);
  const saved = useStore((s) => s.paneWidths);
  const savedSplit = useStore((s) => s.paneRowSplit);
  const twoRows = useStore((s) => s.options.TwoRows);
  const rowMax = useStore((s) => s.options.TwoRowsMax);
  const shown = useMemo(() => shownTabs(tabs), [tabs]);
  // The rows' tab ids with their width fractions (each row sums to 1).
  const rows = useMemo(() => {
    const ids = shown.map((t) => t.id);
    const [top, bottom] = splitRows(ids.length, twoRows, rowMax);
    const parts = bottom > 0 ? [ids.slice(0, top), ids.slice(top)] : [ids];
    return parts.map((rowIds) => ({ ids: rowIds, fractions: resolveFractions(rowIds, saved) }));
  }, [shown, twoRows, rowMax, saved]);
  const split = savedSplit ?? 0.5;
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = initDnd();
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  // A window resize arranges the panes evenly again.
  useEffect(() => {
    const onResize = () => setState({ paneWidths: null, paneRowSplit: null });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Border between panes i and i+1 of one row.
  const startResize = (e: React.PointerEvent<HTMLDivElement>, r: number, i: number) => {
    const area = areaRef.current;
    if (!area || e.button !== 0) return;
    const { ids, fractions: start } = rows[r];
    const avail = area.clientWidth - SPLITTER * (ids.length - 1);
    const x0 = e.clientX;
    trackDrag(e, (ev) => {
      const next = resizePair(start, i, (ev.clientX - x0) / avail, MIN_PANE_PX / avail);
      // The other row keeps its widths: fractions are normalised per row.
      const widths = { ...getState().paneWidths, ...Object.fromEntries(ids.map((id, k) => [id, next[k]])) };
      setState({ paneWidths: widths });
    });
  };

  // Border between the two rows.
  const startRowResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const area = areaRef.current;
    if (!area || e.button !== 0) return;
    const avail = area.clientHeight - SPLITTER;
    const start = [split, 1 - split];
    const y0 = e.clientY;
    trackDrag(e, (ev) => {
      setState({ paneRowSplit: resizePair(start, 0, (ev.clientY - y0) / avail, MIN_ROW_PX / avail)[0] });
    });
  };

  // Pointer-down anywhere in a pane makes it current (without consuming the event).
  const makeCurrent = (id: string) => {
    if (getState().tabs.currentId === id) return;
    setTabs((s) => focusTab(s, id));
  };

  return (
    <div className="pane-area" ref={areaRef}>
      {rows.map((row, r) => (
        <Fragment key={r}>
          {r > 0 && <div className="splitter-row" onPointerDown={startRowResize} />}
          <div className="pane-row" style={{ flex: `${rows.length < 2 ? 1 : r === 0 ? split : 1 - split} 1 0px` }}>
            {row.ids.map((id, i) => (
              <Fragment key={id}>
                {i > 0 && <div className="splitter" onPointerDown={(e) => startResize(e, r, i - 1)} />}
                <div
                  className="pane"
                  style={{ flex: `${row.fractions[i]} 1 0px` }}
                  data-drop-pane={id}
                  onPointerDownCapture={() => makeCurrent(id)}
                >
                  <Pane id={id} />
                </div>
              </Fragment>
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
