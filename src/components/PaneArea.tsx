// Arranges the shown tabs' panes side by side. Spec: docs/spec/tabs.md「ペインの配置」

import { Fragment, useEffect, useMemo, useRef } from "react";
import { focusTab, shownTabs } from "../model/tabs";
import { setTabs } from "../state/actions";
import { initDnd } from "../state/dnd";
import { getState, setState, useStore } from "../state/store";
import { Pane } from "./Pane";
import { resizePair, resolveFractions } from "./pane/arrange";
import "../styles/pane.css";

const SPLITTER = 4;
const MIN_PANE_PX = 40;

export function PaneArea() {
  const tabs = useStore((s) => s.tabs);
  const saved = useStore((s) => s.paneWidths);
  const shown = useMemo(() => shownTabs(tabs), [tabs]);
  const ids = useMemo(() => shown.map((t) => t.id), [shown]);
  const fractions = useMemo(() => resolveFractions(ids, saved), [ids, saved]);
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = initDnd();
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  // A window resize arranges the panes evenly again.
  useEffect(() => {
    const onResize = () => setState({ paneWidths: null });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startResize = (e: React.PointerEvent<HTMLDivElement>, i: number) => {
    const area = areaRef.current;
    if (!area || e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const avail = area.clientWidth - SPLITTER * (ids.length - 1);
    const start = fractions;
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => {
      const next = resizePair(start, i, (ev.clientX - x0) / avail, MIN_PANE_PX / avail);
      setState({ paneWidths: Object.fromEntries(ids.map((id, k) => [id, next[k]])) });
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };

  // Pointer-down anywhere in a pane makes it current (without consuming the event).
  const makeCurrent = (id: string) => {
    if (getState().tabs.currentId === id) return;
    const widths = getState().paneWidths;
    setTabs((s) => focusTab(s, id));
    // setTabs resets the layout; focusing a pane must keep the user's widths.
    if (widths) setState({ paneWidths: widths });
  };

  return (
    <div className="pane-area" ref={areaRef}>
      {shown.map((t, i) => (
        <Fragment key={t.id}>
          {i > 0 && <div className="splitter" onPointerDown={(e) => startResize(e, i - 1)} />}
          <div
            className="pane"
            style={{ flex: `${fractions[i]} 1 0px` }}
            data-drop-pane={t.id}
            onPointerDownCapture={() => makeCurrent(t.id)}
          >
            <Pane id={t.id} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}
