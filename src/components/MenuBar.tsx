// Menu bar (menu.xml). Alt alone highlights the bar; Alt+key opens a menu.
import { useCallback, useEffect, useRef, useState } from "react";
import { menuLabel, runItem } from "../commands/items";
import { useConfig } from "../config/store";
import { NO_MODS } from "../model/navigation";
import { getState } from "../state/store";
import { PopupMenu, splitLabel } from "./PopupMenu";
import "../styles/chrome.css";

interface Opened {
  index: number;
  /** Opened from the keyboard: select the first item. */
  kbd: boolean;
  rect: DOMRect;
}

const isBarItem = (t: Element) => !!t.closest(".menubar-item");

export function MenuBar() {
  const menu = useConfig((s) => s.menu);
  const [open, setOpen] = useState<Opened | null>(null);
  /** Index highlighted by keyboard navigation (after Alt alone), or null. */
  const [hot, setHot] = useState<number | null>(null);
  const itemEls = useRef<(HTMLButtonElement | null)[]>([]);
  const altState = useRef({ down: false, other: false });

  const close = useCallback(() => setOpen(null), []);

  const openAt = useCallback(
    (index: number, kbd: boolean) => {
      const item = menu[index];
      if (!item) return;
      const rect = itemEls.current[index]?.getBoundingClientRect();
      if (item.children?.length && rect) setOpen({ index, kbd, rect });
      else {
        setOpen(null);
        void runItem(item, NO_MODS);
      }
      setHot(null);
    },
    [menu],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (getState().dialog) return;
      if (e.key === "Alt") {
        if (!e.repeat) altState.current = { down: true, other: false };
        return;
      }
      if (e.key === "Control" || e.key === "Shift" || e.key === "Meta") return;
      altState.current.other = true;
      if (e.altKey && !e.ctrlKey && e.key.length === 1) {
        const k = e.key.toLowerCase();
        const i = menu.findIndex((m) => menuLabel(m.text).accessKey === k);
        if (i >= 0) {
          e.preventDefault();
          e.stopPropagation();
          openAt(i, true);
        }
        return;
      }
      if (hot === null || open) return;
      // Keyboard navigation of the highlighted bar.
      const n = menu.length;
      switch (e.key) {
        case "ArrowRight":
          setHot((hot + 1) % n);
          break;
        case "ArrowLeft":
          setHot((hot - 1 + n) % n);
          break;
        case "ArrowDown":
        case "ArrowUp":
        case "Enter":
          openAt(hot, true);
          break;
        case "Escape":
          setHot(null);
          break;
        default: {
          if (e.key.length === 1 && !e.ctrlKey) {
            const k = e.key.toLowerCase();
            const i = menu.findIndex((m) => menuLabel(m.text).accessKey === k);
            if (i >= 0) openAt(i, true);
          }
          return;
        }
      }
      e.preventDefault();
      e.stopPropagation();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Alt") return;
      const { down, other } = altState.current;
      altState.current = { down: false, other: false };
      if (!down || other || getState().dialog) return;
      e.preventDefault();
      if (open) setOpen(null);
      setHot((h) => (h === null && !open ? 0 : null));
    };
    const onPointerDown = () => {
      altState.current.other = true;
      setHot(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [menu, hot, open, openAt]);

  const sibling = (dir: -1 | 1) => {
    if (!open) return;
    const n = menu.length;
    openAt((open.index + dir + n) % n, true);
  };

  return (
    <div className="menubar" role="menubar">
      {menu.map((item, i) => {
        const { before, key, after } = splitLabel(item);
        const cls = `menubar-item${open?.index === i ? " open" : ""}${hot === i ? " hot" : ""}`;
        return (
          <button
            key={i}
            type="button"
            className={cls}
            tabIndex={-1}
            ref={(el) => {
              itemEls.current[i] = el;
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              if (open?.index === i) close();
              else openAt(i, false);
            }}
            onMouseEnter={() => {
              if (open && open.index !== i) openAt(i, false);
            }}
          >
            {before}
            {key && <u>{key}</u>}
            {after}
          </button>
        );
      })}
      {open && menu[open.index]?.children && (
        <PopupMenu
          key={open.index}
          items={menu[open.index].children ?? []}
          x={open.rect.left}
          y={open.rect.bottom}
          onClose={close}
          onSibling={sibling}
          ignoreOutside={isBarItem}
          selectFirst={open.kbd}
        />
      )}
    </div>
  );
}
