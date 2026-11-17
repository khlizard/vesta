// Link bar (link.xml). Spec: docs/spec/config.md「link.xml」
import type { MouseEvent } from "react";
import { modsOf } from "../model/input";
import { linkBarView, type LinkButtonView } from "../presenters/linkBar";
import { useView } from "../presenters/view";
import { dispatch } from "../root/dispatch";
import "../styles/chrome.css";

/** Where the menu of a button opens: under its left edge. */
function below(e: MouseEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left, y: r.bottom };
}

function LinkButton({ b }: { b: LinkButtonView }) {
  const { before, key, after } = b.label;
  return (
    <button
      type="button"
      className={b.missing ? "link-btn missing" : "link-btn"}
      title={b.title}
      onClick={(e) => dispatch({ type: "link.click", index: b.index, mods: modsOf(e), at: below(e) })}
      onMouseEnter={(e) => dispatch({ type: "link.hover", index: b.index, at: below(e) })}
      onAuxClick={(e) => {
        if (e.button === 1) dispatch({ type: "link.click", index: b.index, mods: modsOf(e), middle: true, at: below(e) });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        dispatch({ type: "link.context", index: b.index, at: { x: e.clientX, y: e.clientY } });
      }}
    >
      {b.icon && <img src={b.icon} width={16} height={16} alt="" draggable={false} />}
      {b.missing && <span className="link-missing">{b.missing}</span>}
      <span className="link-text">
        {before}
        {key && <u>{key}</u>}
        {after}
      </span>
      {b.arrow && <span className="link-arrow">▼</span>}
    </button>
  );
}

export function LinkBar() {
  const buttons = useView(linkBarView);
  return (
    // The list keeps the keyboard focus when a button is pressed.
    <div className="linkbar" onMouseDown={(e) => e.preventDefault()}>
      {buttons.map((b) => (
        <LinkButton key={b.index} b={b} />
      ))}
    </div>
  );
}
