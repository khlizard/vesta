// Nested popup menu (menu bar, tool bar drop-downs, link bar, tab context menu, key binding menus).
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { commandChecked, commandEnabled } from "../commands/registry";
import { menuLabel, runItem } from "../commands/items";
import type { Mods } from "../model/navigation";
import { CommandIcon } from "./CommandIcon";
import { accessKeyPressed, closePopup, isSeparator, usePopup, type PopupItem } from "./popupBus";
import "../styles/chrome.css";

const EMPTY_TEXT = "（なし）";

/** Shown in place of the icon of a link item whose path was not found. */
export const MISSING_MARK = "×";

/** Tooltip of a link item whose path was not found. */
export function missingTitle(path: string | undefined): string {
  return `見つかりません: ${path ?? ""}`;
}

/** Label split around the access key (`_X`) for underlined rendering. */
export function splitLabel(item: { text?: string; literal?: boolean; execute?: string; navigate?: string; path?: string; command?: string }): {
  before: string;
  key: string;
  after: string;
} {
  const raw = item.text || item.execute || item.navigate || item.path || item.command || "";
  if (item.literal || !item.text) return { before: raw, key: "", after: "" };
  const t = raw.replace("{*}", "");
  const i = t.indexOf("_");
  if (i < 0 || i === t.length - 1) return { before: t, key: "", after: "" };
  return { before: t.slice(0, i), key: t[i + 1], after: t.slice(i + 2) };
}

function accessKeyOf(item: PopupItem): string | null {
  if (item.literal) return null;
  return menuLabel(item.text).accessKey;
}

const hasChildren = (item: PopupItem) => !!item.children?.length || !!item.loadChildren;

function isDisabled(item: PopupItem): boolean {
  if (item.disabled !== undefined) return item.disabled;
  if (hasChildren(item)) return false;
  if (item.command) return !commandEnabled(item.command);
  return false;
}

const modsOf = (e: { ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): Mods => ({
  ctrl: e.ctrlKey,
  shift: e.shiftKey,
  alt: e.altKey,
});

interface MenuProps {
  items: PopupItem[];
  x: number;
  y: number;
  /** Rect of the parent item (submenus); the menu opens beside it. */
  parentRect?: DOMRect;
  /** Closes the whole popup tree. */
  onClose: () => void;
  /** Submenus: closes only this menu. */
  onBack?: () => void;
  /** Root menu of the menu bar: Left/Right switch to the neighbouring top-level menu. */
  onSibling?: (dir: -1 | 1) => void;
  /** Root menu: clicks on these elements are not "outside" clicks. */
  ignoreOutside?: (target: Element) => boolean;
  selectFirst?: boolean;
}

interface SubState {
  index: number;
  rect: DOMRect;
  first: boolean;
}

export function PopupMenu(props: MenuProps) {
  const { items, x, y, parentRect, onClose, onBack, onSibling, ignoreOutside, selectFirst } = props;
  const list = items.length ? items : [{ text: EMPTY_TEXT, literal: true, onSelect: () => {}, separator: false } as PopupItem];
  const empty = items.length === 0;
  const rootRef = useRef<HTMLDivElement>(null);
  const itemEls = useRef<(HTMLDivElement | null)[]>([]);
  const selectable = (i: number) => !isSeparator(list[i]) && !isDisabled(list[i]) && !empty;
  const [active, setActive] = useState(() => {
    if (!selectFirst) return -1;
    return empty ? -1 : list.findIndex((it) => !isSeparator(it) && !isDisabled(it));
  });
  const [sub, setSub] = useState<SubState | null>(null);

  // Keep the menu inside the viewport.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = x;
    let top = y;
    if (left + w > window.innerWidth) left = parentRect ? parentRect.left - w + 2 : window.innerWidth - w;
    if (top + h > window.innerHeight) top = Math.max(0, window.innerHeight - h);
    el.style.left = `${Math.max(0, left)}px`;
    el.style.top = `${top}px`;
  }, [x, y, parentRect]);

  const openSub = (index: number, first: boolean) => {
    const el = itemEls.current[index];
    if (!el) return;
    setActive(index);
    setSub({ index, rect: el.getBoundingClientRect(), first });
  };

  const activate = (index: number, mods: Mods) => {
    const item = list[index];
    if (!item || isSeparator(item) || isDisabled(item) || empty) return;
    if (hasChildren(item)) {
      openSub(index, true);
      return;
    }
    onClose();
    if (item.onSelect) item.onSelect(mods);
    else void runItem(item, mods);
  };

  // Keyboard: only the innermost open menu reacts.
  useEffect(() => {
    if (sub) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Shift" || e.key === "Alt" || e.key === "Meta") return;
      e.preventDefault();
      e.stopPropagation();
      const move = (dir: 1 | -1) => {
        const n = list.length;
        let i = active;
        for (let k = 0; k < n; k++) {
          i = (i + dir + n) % n;
          if (selectable(i)) {
            setActive(i);
            return;
          }
        }
      };
      switch (e.key) {
        case "ArrowDown":
          return move(1);
        case "ArrowUp":
          return move(-1);
        case "ArrowRight":
          if (active >= 0 && hasChildren(list[active]) && !isDisabled(list[active])) openSub(active, true);
          else onSibling?.(1);
          return;
        case "ArrowLeft":
          if (onBack) onBack();
          else onSibling?.(-1);
          return;
        case "Escape":
          if (onBack) onBack();
          else onClose();
          return;
        case "Enter":
          if (active >= 0) activate(active, modsOf(e));
          return;
        case "Home":
          return setActive(list.findIndex((_, i) => selectable(i)));
        case "End": {
          for (let i = list.length - 1; i >= 0; i--) {
            if (selectable(i)) return setActive(i);
          }
          return;
        }
      }
      const k = accessKeyPressed(e);
      if (k) {
        const hits = list.map((it, i) => (accessKeyOf(it) === k && selectable(i) ? i : -1)).filter((i) => i >= 0);
        if (hits.length === 1) activate(hits[0], modsOf(e));
        else if (hits.length > 1) setActive(hits.find((i) => i > active) ?? hits[0]);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, active, list, onBack, onClose, onSibling]);

  // Root menu: close on outside click and window blur.
  const isRoot = !onBack;
  useEffect(() => {
    if (!isRoot) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || t.closest(".popup") || ignoreOutside?.(t)) return;
      onClose();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("blur", onClose);
    };
  }, [isRoot, onClose, ignoreOutside]);

  const style = { left: x, top: y };
  return (
    <>
      <div className="popup" ref={rootRef} style={style} onContextMenu={(e) => e.preventDefault()}>
        {list.map((item, i) => {
          if (isSeparator(item)) return <div key={i} className="popup-sep" />;
          const disabled = isDisabled(item) || empty;
          const checked = item.checked ?? (!!item.command && !hasChildren(item) && commandChecked(item.command));
          const { before, key, after } = splitLabel(item);
          const arrow = hasChildren(item);
          return (
            <div
              key={i}
              ref={(el) => {
                itemEls.current[i] = el;
              }}
              className={`popup-item${i === active ? " active" : ""}${disabled ? " disabled" : ""}${item.missing ? " missing" : ""}`}
              title={item.missing ? missingTitle(item.path) : undefined}
              onMouseEnter={() => {
                if (disabled) return setSub(null);
                if (arrow) openSub(i, false);
                else {
                  setActive(i);
                  setSub(null);
                }
              }}
              onClick={(e) => activate(i, modsOf(e))}
              onAuxClick={(e: ReactMouseEvent) => {
                if (e.button === 1) activate(i, { ctrl: true, shift: e.shiftKey, alt: e.altKey });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                item.onContextMenu?.(e);
              }}
            >
              <span className={`popup-icon${checked ? " checked" : ""}`}>
                {item.missing ? (
                  MISSING_MARK
                ) : item.iconSrc ? (
                  <img src={item.iconSrc} width={16} height={16} alt="" draggable={false} />
                ) : item.image !== undefined ? (
                  <CommandIcon index={item.image} size={16} disabled={disabled} />
                ) : checked ? (
                  "✓"
                ) : null}
              </span>
              <span className="popup-label">
                {before}
                {key && <u>{key}</u>}
                {after}
              </span>
              <span className="popup-arrow">{arrow ? "▶" : ""}</span>
            </div>
          );
        })}
      </div>
      {sub && list[sub.index] && (
        <SubMenu
          item={list[sub.index]}
          rect={sub.rect}
          first={sub.first}
          onClose={onClose}
          onBack={() => setSub(null)}
        />
      )}
    </>
  );
}

function SubMenu(props: { item: PopupItem; rect: DOMRect; first: boolean; onClose: () => void; onBack: () => void }) {
  const { item, rect, first, onClose, onBack } = props;
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
  return (
    <PopupMenu
      items={children}
      x={rect.right - 2}
      y={rect.top - 3}
      parentRect={rect}
      onClose={onClose}
      onBack={onBack}
      selectFirst={first}
    />
  );
}

/** Renders the popup requested through `openPopup` (mounted once, inside `Dialogs`). */
export function PopupHost() {
  const popup = usePopup((s) => s.popup);
  if (!popup) return null;
  return <PopupMenu key={`${popup.x},${popup.y}`} items={popup.items} x={popup.x} y={popup.y} onClose={closePopup} selectFirst />;
}
