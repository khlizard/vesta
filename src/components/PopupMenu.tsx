// The popup menu (menu bar, tool bar drop-downs, link bar, context menus, key binding menus).
// Spec: docs/spec/ui.md「モード」
//
// The menu has the keyboard focus while it is open, so its keys come to it. Which item is
// picked and which submenu is open is the menu's own business while it is on screen; what was
// chosen is sent to the root.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { modsOf } from "../model/input";
import { accessKeyTarget, endSelectable, nextSelectable, placeMenu } from "../model/menu";
import type { Mods } from "../model/navigation";
import { popupView } from "../presenters/chrome";
import {
  accessKeyPressed,
  hasSubmenu,
  isSeparator,
  itemAccessKey,
  itemLabel,
  itemState,
  MISSING_MARK,
  missingTitle,
} from "../presenters/items";
import { useView } from "../presenters/view";
import { dispatch } from "../root/dispatch";
import { POPUP_ATTR } from "../root/input";
import type { PopupItem } from "../state/popup";
import { CommandIcon } from "./CommandIcon";
import "../styles/chrome.css";

const EMPTY_TEXT = "（なし）";
const EMPTY: PopupItem = { text: EMPTY_TEXT, literal: true, disabled: true };
/** Indent of a label per level (the ancestors of a folder), in px. */
const INDENT = 12;

interface MenuProps {
  items: PopupItem[];
  x: number;
  y: number;
  /** Rect of the parent item (submenus); the menu opens beside it. */
  parentRect?: DOMRect;
  /** Submenus: closes only this menu. */
  onBack?: () => void;
  selectFirst?: boolean;
}

interface SubState {
  index: number;
  rect: DOMRect;
  first: boolean;
}

function Menu({ items, x, y, parentRect, onBack, selectFirst }: MenuProps) {
  const list = items.length ? items : [EMPTY];
  const states = list.map(itemState);
  const rootRef = useRef<HTMLDivElement>(null);
  const itemEls = useRef<(HTMLDivElement | null)[]>([]);
  const selectable = (i: number) => !isSeparator(list[i]) && states[i].enabled;
  const [active, setActive] = useState(() => (selectFirst ? endSelectable(list.length, 1, selectable) : -1));
  const [sub, setSub] = useState<SubState | null>(null);

  // Keep the menu inside the viewport.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const at = placeMenu(
      { x, y },
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      parentRect?.left,
    );
    el.style.left = `${at.left}px`;
    el.style.top = `${at.top}px`;
  }, [x, y, parentRect]);

  // The innermost open menu has the focus: when it opens, and again when its submenu closes.
  useEffect(() => {
    if (!sub) rootRef.current?.focus({ preventScroll: true });
  }, [sub]);

  const openSub = (index: number, first: boolean) => {
    const el = itemEls.current[index];
    if (!el) return;
    setActive(index);
    setSub({ index, rect: el.getBoundingClientRect(), first });
  };

  const activate = (index: number, mods: Mods) => {
    const item = list[index];
    if (!item || !selectable(index)) return;
    if (hasSubmenu(item)) openSub(index, true);
    else dispatch({ type: "menu.select", item, mods });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Control" || e.key === "Shift" || e.key === "Alt" || e.key === "Meta") return;
    e.preventDefault();
    e.stopPropagation();
    // A submenu that is still loading has not taken the focus yet; the keys wait for it.
    if (sub) return;
    switch (e.key) {
      case "ArrowDown":
        return setActive(nextSelectable(list.length, active, 1, selectable));
      case "ArrowUp":
        return setActive(nextSelectable(list.length, active, -1, selectable));
      case "ArrowRight":
        if (active >= 0 && hasSubmenu(list[active]) && selectable(active)) openSub(active, true);
        else dispatch({ type: "menu.sibling", dir: 1 });
        return;
      case "ArrowLeft":
        if (onBack) onBack();
        else dispatch({ type: "menu.sibling", dir: -1 });
        return;
      case "Escape":
        if (onBack) onBack();
        else dispatch({ type: "menu.close" });
        return;
      case "Enter":
        if (active >= 0) activate(active, modsOf(e));
        return;
      case "Home":
        return setActive(endSelectable(list.length, 1, selectable));
      case "End": {
        const last = endSelectable(list.length, -1, selectable);
        if (last >= 0) setActive(last);
        return;
      }
    }
    const k = accessKeyPressed(e);
    const hit = k ? accessKeyTarget(list.map(itemAccessKey), k, active, selectable) : null;
    if (hit && "run" in hit) activate(hit.run, modsOf(e));
    else if (hit) setActive(hit.select);
  };

  return (
    <>
      <div
        className="popup"
        ref={rootRef}
        tabIndex={-1}
        style={{ left: x, top: y }}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
        {...{ [POPUP_ATTR]: "" }}
      >
        {list.map((item, i) => {
          if (isSeparator(item)) return <div key={i} className="popup-sep" />;
          const { enabled, checked } = states[i];
          const { before, key, after } = itemLabel(item);
          const arrow = hasSubmenu(item);
          return (
            <div
              key={i}
              ref={(el) => {
                itemEls.current[i] = el;
              }}
              className={`popup-item${i === active ? " active" : ""}${enabled ? "" : " disabled"}${item.missing ? " missing" : ""}`}
              title={item.missing ? missingTitle(item.path) : undefined}
              onMouseEnter={() => {
                if (!enabled) return setSub(null);
                if (arrow) openSub(i, false);
                else {
                  setActive(i);
                  setSub(null);
                }
              }}
              onClick={(e) => activate(i, modsOf(e))}
              onAuxClick={(e: MouseEvent) => {
                if (e.button === 1) activate(i, { ...modsOf(e), ctrl: true });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                dispatch({ type: "menu.context", item, at: { x: e.clientX, y: e.clientY } });
              }}
            >
              <span className={`popup-icon${checked ? " checked" : ""}`}>
                {item.missing ? (
                  MISSING_MARK
                ) : item.iconSrc ? (
                  <img src={item.iconSrc} width={16} height={16} alt="" draggable={false} />
                ) : item.image !== undefined ? (
                  <CommandIcon index={item.image} size={16} disabled={!enabled} />
                ) : checked ? (
                  "✓"
                ) : null}
              </span>
              <span
                className="popup-label"
                style={{ paddingLeft: item.indent ? item.indent * INDENT : undefined, fontWeight: item.strong ? "bold" : undefined }}
              >
                {before}
                {key && <u>{key}</u>}
                {after}
              </span>
              <span className="popup-arrow">{arrow ? "▶" : ""}</span>
            </div>
          );
        })}
      </div>
      {sub && list[sub.index] && <SubMenu item={list[sub.index]} rect={sub.rect} first={sub.first} onBack={() => setSub(null)} />}
    </>
  );
}

function SubMenu(props: { item: PopupItem; rect: DOMRect; first: boolean; onBack: () => void }) {
  const { item, rect, first, onBack } = props;
  const [loaded, setLoaded] = useState<PopupItem[] | null>(null);
  const load = item.loadChildren;
  useEffect(() => {
    if (!load) return;
    let alive = true;
    load().then(
      (r) => alive && setLoaded(r),
      () => alive && setLoaded([]),
    );
    return () => {
      alive = false;
    };
  }, [load]);
  const children = load ? loaded : (item.children ?? []);
  if (!children) return null;
  return <Menu items={children} x={rect.right - 2} y={rect.top - 3} parentRect={rect} onBack={onBack} selectFirst={first} />;
}

/** Draws the open popup menu, if any (mounted once, at the top of the window). */
export function PopupHost() {
  const popup = useView(popupView);
  if (!popup) return null;
  // A new popup is a new menu: nothing of the one before it (the picked item, an open submenu) stays.
  return <Menu key={popup.seq} items={popup.items} x={popup.x} y={popup.y} selectFirst={!popup.byMouse} />;
}
