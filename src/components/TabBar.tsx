// Tab bar. Spec: docs/spec/tabs.md
import { useRef, type PointerEvent } from "react";
import { cx, dragStarted, modsOf } from "../model/input";
import { dragOverIndex } from "../model/tabs";
import { tabBarView } from "../presenters/tabBar";
import { useView } from "../presenters/view";
import { dispatch } from "../root/dispatch";
import "../styles/chrome.css";

interface DragState {
  id: string;
  x: number;
  y: number;
  moved: boolean;
}

export function TabBar() {
  const tabs = useView(tabBarView);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  /** The elements of the tabs, to see which one a dragged tab is over. */
  const els = useRef(new Map<string, HTMLDivElement>());

  const onPointerDown = (e: PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0) return;
    drag.current = { id, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && !dragStarted(e.clientX - d.x, e.clientY - d.y)) return;
    d.moved = true;
    const from = tabs.findIndex((t) => t.id === d.id);
    if (from < 0) return;
    const boxes = tabs.map((t) => els.current.get(t.id)?.getBoundingClientRect() ?? null);
    const to = dragOverIndex(from, boxes, e.clientX, e.clientY);
    if (to !== null) dispatch({ type: "tab.dragOver", id: d.id, over: tabs[to].id });
  };

  const endDrag = () => {
    if (drag.current?.moved) {
      // The click that follows the release of a dragged tab is not a click on it.
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
    drag.current = null;
  };

  return (
    // The list keeps the keyboard focus when a tab is pressed.
    <div className="tabbar-wrap" onMouseDown={(e) => e.preventDefault()}>
      <div
        className="tabbar"
        onWheel={(e) => {
          if (e.deltaY !== 0) dispatch({ type: "tab.wheel", dir: e.deltaY > 0 ? 1 : -1 });
        }}
      >
        {tabs.map((t) => {
          const cls = cx("tab", t.shown ? "shown" : "hidden", t.current && "current", t.locked && "locked");
          return (
            <div
              key={t.id}
              ref={(el) => {
                if (el) els.current.set(t.id, el);
                else els.current.delete(t.id);
              }}
              className={cls}
              data-drop-tab={t.id}
              title={t.title}
              onPointerDown={(e) => onPointerDown(e, t.id)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onClick={(e) => {
                if (!suppressClick.current) dispatch({ type: "tab.click", id: t.id, mods: modsOf(e) });
              }}
              onDoubleClick={() => {
                if (!suppressClick.current) dispatch({ type: "tab.doubleClick", id: t.id });
              }}
              onAuxClick={(e) => {
                if (e.button === 1) dispatch({ type: "tab.middleClick", id: t.id });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                dispatch({ type: "tab.context", id: t.id, at: { x: e.clientX, y: e.clientY } });
              }}
            >
              <span className="tab-label">{t.label}</span>
            </div>
          );
        })}
      </div>
      <div className="tabbar-line" />
    </div>
  );
}
