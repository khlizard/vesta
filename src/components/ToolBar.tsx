// Tool bar (tool.xml): 24px icons, flat buttons, split buttons and drop-downs.
import type { MouseEvent } from "react";
import { Ellipsis } from "lucide-react";
import { modsOf } from "../model/input";
import { toolBarView, type ToolEntry } from "../presenters/toolBar";
import { useView } from "../presenters/view";
import { dispatch } from "../root/dispatch";
import { CommandIcon } from "./CommandIcon";
import "../styles/chrome.css";

type ToolButtonView = Exclude<ToolEntry, { kind: "separator" }>;

/** Asks for the drop-down of a button, under the left edge of its group. */
function dropDown(e: MouseEvent<HTMLElement>, b: ToolButtonView) {
  const r = (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect();
  dispatch({ type: "menu.open", items: b.menu, at: { x: r.left, y: r.bottom } });
}

function ToolButton({ b }: { b: ToolButtonView }) {
  const content =
    b.content === "icon" ? (
      <CommandIcon index={b.image} size={24} disabled={!b.enabled} />
    ) : b.content === "text" ? (
      <span className="tb-text">{b.text}</span>
    ) : (
      <Ellipsis
        className={b.enabled ? "cmd-icon" : "cmd-icon disabled"}
        size={24}
        strokeWidth={1.75}
        aria-hidden="true"
      />
    );

  if (b.kind === "drop") {
    return (
      <div className="tb-group">
        <button type="button" className="tb-btn tb-drop" title={b.title} onClick={(e) => dropDown(e, b)}>
          {content}
          <span className="tb-arrow">▼</span>
        </button>
      </div>
    );
  }
  return (
    <div className="tb-group">
      <button
        type="button"
        className={`tb-btn${b.checked ? " pressed" : ""}${b.kind === "split" ? " tb-main" : ""}`}
        title={b.title}
        disabled={!b.enabled}
        onClick={(e) => dispatch({ type: "item", item: b.item, mods: modsOf(e) })}
        onAuxClick={(e) => {
          if (e.button === 1) dispatch({ type: "item", item: b.item, mods: modsOf(e), middle: true });
        }}
      >
        {content}
      </button>
      {b.kind === "split" && (
        <button type="button" className="tb-btn tb-split" tabIndex={-1} onClick={(e) => dropDown(e, b)}>
          <span className="tb-arrow">▼</span>
        </button>
      )}
    </div>
  );
}

export function ToolBar() {
  const entries = useView(toolBarView);
  return (
    // The list keeps the keyboard focus when a button is pressed.
    <div className="toolbar" onMouseDown={(e) => e.preventDefault()}>
      {entries.map((b, i) =>
        b.kind === "separator" ? <div key={i} className="tb-sep" /> : <ToolButton key={i} b={b} />,
      )}
    </div>
  );
}
