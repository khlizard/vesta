// Per-pane address bar. Spec: docs/spec/navigation.md「アドレスバー」

import { useEffect, useMemo, useRef, useState } from "react";
import { iconUrl } from "../api/urls";
import { committedText } from "../model/address";
import { cx, dragStarted, isImeKey, modsOf } from "../model/input";
import { addressBarView } from "../presenters/addressBar";
import { useView } from "../presenters/view";
import { dispatch } from "../root/dispatch";
import type { Point } from "../root/events";
import { POPUP_ANCHOR_ATTR } from "../root/input";
import { trackPointer } from "./pane/pointer";
import "../styles/pane.css";

export function AddressBar({ id }: { id: string }) {
  const v = useView(useMemo(() => addressBarView(id), [id]));
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Text being typed (null: the folder is shown), and the suggestion the arrow keys are on.
  const [draft, setDraft] = useState<string | null>(null);
  const [pick, setPick] = useState(-1);

  // Other names are offered: the row that was picked is no longer the same one.
  const [offered, setOffered] = useState(v.suggest);
  if (offered !== v.suggest) {
    setOffered(v.suggest);
    setPick(-1);
  }

  // A request made before the field was there (a tab shown again) is not a new one.
  const focused = useRef(v.focusSeq);
  useEffect(() => {
    if (v.focusSeq && v.focusSeq !== focused.current) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    focused.current = v.focusSeq;
  }, [v.focusSeq]);

  // Suggestions show only while typing.
  const suggest = draft !== null ? v.suggest : null;
  const n = suggest?.names.length ?? 0;

  /** Where the drop-down of the ancestors opens: under the left end of the bar. */
  const below = (): Point => {
    const r = rootRef.current?.getBoundingClientRect();
    return { x: r?.left ?? 0, y: r?.bottom ?? 0 };
  };
  /** `toggle`: from the ▼ button, which also closes the list it opened. */
  const dropdown = (toggle = false) => dispatch({ type: "address.dropdown", id, at: below(), toggle });

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    // Keys used by a Japanese conversion (Enter to confirm, arrows, Esc) belong to the IME.
    if (isImeKey(e)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      dispatch({ type: "address.commit", id, text: committedText(suggest, pick, draft ?? v.text), mods: modsOf(e) });
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      // The root moves the focus to the list; losing it here drops what was typed.
      dispatch({ type: "address.cancel", id });
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (n) setPick((p) => (p + 1) % n);
      else dropdown();
    } else if (e.key === "ArrowUp" && n) {
      e.preventDefault();
      setPick((p) => (p <= 0 ? n - 1 : p - 1));
    }
  };

  const onIconPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const stop = trackPointer(
      (ev) => {
        if (!dragStarted(ev.clientX - sx, ev.clientY - sy)) return;
        stop();
        dispatch({ type: "address.dragIcon", id });
      },
      () => {},
    );
  };

  return (
    <div ref={rootRef} className={cx("address", v.current && "current")}>
      <div className="address-box">
        {v.hasFolder && v.iconSrc && (
          <img
            className="address-icon"
            src={v.iconSrc}
            draggable={false}
            alt=""
            onPointerDown={onIconPointerDown}
            onContextMenu={(e) => {
              e.preventDefault();
              dispatch({ type: "address.contextIcon", id, at: { x: e.clientX, y: e.clientY } });
            }}
          />
        )}
        <input
          ref={inputRef}
          className="address-input"
          value={draft ?? v.text}
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value);
            dispatch({ type: "address.input", id, text: e.target.value });
          }}
          onKeyDown={onKeyDown}
          onFocus={() => dispatch({ type: "address.editing", id, on: true })}
          onBlur={() => {
            dispatch({ type: "address.editing", id, on: false });
            setDraft(null);
            setPick(-1);
          }}
          onWheel={() => dropdown()}
        />
        <button
          className="address-drop"
          tabIndex={-1}
          {...{ [POPUP_ANCHOR_ATTR]: "" }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => dropdown(true)}
        >
          ▼
        </button>
      </div>
      {suggest && (
        <div className="address-menu" role="listbox">
          {suggest.names.map((name, i) => (
            <div
              key={name}
              className={cx("address-item", i === pick && "picked")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => dispatch({ type: "address.commit", id, text: suggest.parent + name, mods: modsOf(e) })}
            >
              <img src={iconUrl(suggest.parent + name)} draggable={false} alt="" />
              <span>{name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
