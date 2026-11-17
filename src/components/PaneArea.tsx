// Arranges the shown tabs' panes side by side, in one or two rows. Spec: docs/spec/tabs.md「ペインの配置」

import { Fragment, useRef } from "react";
import { paneAreaView } from "../presenters/paneArea";
import { useView } from "../presenters/view";
import { dispatch } from "../root/dispatch";
import { Pane } from "./Pane";
import { resizePair } from "../model/arrange";
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
  const v = useView(paneAreaView);
  const areaRef = useRef<HTMLDivElement>(null);

  // Border between panes i and i+1 of one row.
  const startResize = (e: React.PointerEvent<HTMLDivElement>, r: number, i: number) => {
    const area = areaRef.current;
    if (!area || e.button !== 0) return;
    const { ids, fractions: start } = v.rows[r];
    const avail = area.clientWidth - SPLITTER * (ids.length - 1);
    const x0 = e.clientX;
    trackDrag(e, (ev) => {
      const next = resizePair(start, i, (ev.clientX - x0) / avail, MIN_PANE_PX / avail);
      dispatch({ type: "pane.widths", widths: Object.fromEntries(ids.map((id, k) => [id, next[k]])) });
    });
  };

  // Border between the two rows.
  const startRowResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const area = areaRef.current;
    if (!area || e.button !== 0) return;
    const avail = area.clientHeight - SPLITTER;
    const start = [v.split, 1 - v.split];
    const y0 = e.clientY;
    trackDrag(e, (ev) => {
      dispatch({ type: "pane.rowSplit", split: resizePair(start, 0, (ev.clientY - y0) / avail, MIN_ROW_PX / avail)[0] });
    });
  };

  return (
    <div className="pane-area" ref={areaRef}>
      {v.rows.map((row, r) => (
        <Fragment key={r}>
          {r > 0 && <div className="splitter-row" onPointerDown={startRowResize} />}
          <div className="pane-row" style={{ flex: `${row.height} 1 0px` }}>
            {row.ids.map((id, i) => (
              <Fragment key={id}>
                {i > 0 && <div className="splitter" onPointerDown={(e) => startResize(e, r, i - 1)} />}
                <div
                  className="pane"
                  style={{ flex: `${row.fractions[i]} 1 0px` }}
                  data-drop-pane={id}
                  // Seen on the way down, without consuming it: the pane becomes the current one.
                  onPointerDownCapture={() => dispatch({ type: "pane.press", id })}
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
