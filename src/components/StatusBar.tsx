// Status bar: pane text on the left, status.xml buttons on the right. Spec: docs/spec/listing.md
import { modsOf } from "../model/input";
import { statusBarView } from "../presenters/statusBar";
import { useView } from "../presenters/view";
import { dispatch } from "../root/dispatch";
import { CommandIcon } from "./CommandIcon";
import "../styles/chrome.css";

export function StatusBar() {
  const { text, update, buttons } = useView(statusBarView);
  return (
    // The list keeps the keyboard focus when a button is pressed.
    <div className="statusbar" onMouseDown={(e) => e.preventDefault()}>
      {update && (
        <button
          type="button"
          className="status-update"
          title={update.title}
          onClick={(e) => dispatch({ type: "item", item: update.item, mods: modsOf(e) })}
        >
          {update.label}
        </button>
      )}
      <div className="status-text">{text}</div>
      <div className="status-buttons">
        {buttons.map((b, i) =>
          b.kind === "separator" ? (
            <div key={i} className="status-sep" />
          ) : (
            <button
              key={i}
              type="button"
              className={`status-btn${b.checked ? " pressed" : ""}`}
              title={b.title}
              disabled={!b.enabled}
              onClick={(e) => dispatch({ type: "item", item: b.item, mods: modsOf(e) })}
            >
              {b.image !== null ? (
                <CommandIcon index={b.image} size={16} disabled={!b.enabled} />
              ) : (
                <span className="status-btn-text">{b.text}</span>
              )}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
