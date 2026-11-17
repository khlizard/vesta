// Tab bar. Spec: docs/spec/tabs.md
import { useMemo, useRef, type MouseEvent, type PointerEvent } from "react";
import { closeTabs, closeTarget, setTabs } from "../state/actions";
import { dragStarted } from "../model/input";
import { computeLabels } from "../model/labels";
import * as T from "../model/tabs";
import { getState, useStore } from "../state/store";
import { openPopup, type PopupItem } from "./popupBus";
import "../styles/chrome.css";


interface DragState {
  id: string;
  x: number;
  y: number;
  moved: boolean;
}

function showTabMenu(e: MouseEvent, id: string) {
  const s = getState().tabs;
  const tab = s.tabs.find((t) => t.id === id);
  if (!tab) return;
  // Relative targets ("left of current") are computed as if this tab were current.
  const focused = T.focusTab(s, id);
  const none = (target: T.CloseTarget) => T.targetIds(focused, target).length === 0;
  const closeRel = (target: T.CloseTarget) => () => {
    setTabs((x) => T.focusTab(x, id));
    closeTarget(target);
  };
  const items: PopupItem[] = [
    { text: "閉じる(_C)", onSelect: () => closeTabs([id]) },
    { text: "表示(_S)", checked: tab.shown, onSelect: () => setTabs((x) => T.setShown(x, [id], "toggle")) },
    {
      text: "ナビゲートロック(_L)",
      checked: tab.locked,
      onSelect: () => setTabs((x) => T.setLock(x, id, !tab.locked)),
    },
    { separator: true },
    { text: "左側を閉じる(_E)", disabled: none("left"), onSelect: closeRel("left") },
    { text: "右側を閉じる(_R)", disabled: none("right"), onSelect: closeRel("right") },
    { text: "他を閉じる(_O)", disabled: none("others"), onSelect: closeRel("others") },
    { text: "表示中を閉じる(_W)", onSelect: () => closeTarget("shown") },
    { text: "非表示を閉じる(_H)", disabled: none("hidden"), onSelect: () => closeTarget("hidden") },
    { text: "すべて閉じる(_A)", onSelect: () => closeTarget("all") },
  ];
  openPopup(items, e.clientX, e.clientY);
}

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const distinguish = useStore((s) => s.options.DistinguishTab);
  const labels = useMemo(() => computeLabels(tabs.tabs, distinguish), [tabs.tabs, distinguish]);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

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
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-drop-tab]");
    const otherId = over?.dataset.dropTab;
    if (!over || !otherId || otherId === d.id) return;
    const list = getState().tabs.tabs;
    const from = list.findIndex((t) => t.id === d.id);
    const to = list.findIndex((t) => t.id === otherId);
    if (from < 0 || to < 0) return;
    const r = over.getBoundingClientRect();
    const mid = r.left + r.width / 2;
    if ((to > from && e.clientX > mid) || (to < from && e.clientX < mid)) {
      setTabs((s) => T.moveTab(s, d.id, to));
    }
  };

  const endDrag = () => {
    if (drag.current?.moved) {
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    }
    drag.current = null;
  };

  const click = (e: MouseEvent, id: string) => {
    if (suppressClick.current) return;
    setTabs((s) => (e.ctrlKey ? T.toggleShown(s, id) : T.clickTab(s, id)));
  };

  return (
    <div className="tabbar-wrap" onMouseDown={(e) => e.preventDefault()}>
      <div
        className="tabbar"
        onWheel={(e) => {
          if (e.deltaY !== 0) setTabs((s) => T.wheelTabs(s, e.deltaY > 0 ? 1 : -1));
        }}
      >
        {tabs.tabs.map((t) => {
          const cls = ["tab", t.shown ? "shown" : "hidden", t.id === tabs.currentId ? "current" : "", t.locked ? "locked" : ""]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={t.id}
              className={cls}
              data-drop-tab={t.id}
              title={t.fsPath ?? t.displayName}
              onPointerDown={(e) => onPointerDown(e, t.id)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onClick={(e) => click(e, t.id)}
              onDoubleClick={() => {
                if (!suppressClick.current) setTabs((s) => T.toggleLock(s, t.id));
              }}
              onAuxClick={(e) => {
                if (e.button === 1) closeTabs([t.id]);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                showTabMenu(e, t.id);
              }}
            >
              <span className="tab-label">{labels.get(t.id) ?? t.displayName}</span>
            </div>
          );
        })}
      </div>
      <div className="tabbar-line" />
    </div>
  );
}
