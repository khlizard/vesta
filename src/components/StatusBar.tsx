// Status bar: pane text on the left, status.xml buttons on the right. Spec: docs/spec/listing.md
import { commandChecked, commandEnabled, runCommand } from "../commands/registry";
import { runItem } from "../commands/items";
import { useConfig } from "../config/store";
import { statusText } from "../model/format";
import { selectedEntries } from "../state/selection";
import { useStore } from "../state/store";
import { CommandIcon } from "./CommandIcon";
import { modsOf } from "../model/input";
import { isSeparator } from "./popupBus";
import "../styles/chrome.css";

export function StatusBar() {
  const status = useConfig((s) => s.status);
  const message = useStore((s) => s.message);
  const updateReady = useStore((s) => s.updateReady);
  const pane = useStore((s) => (s.tabs.currentId ? s.panes[s.tabs.currentId] : null));
  useStore(); // checked/enabled state of the buttons is derived from the whole store

  let text = message ?? "";
  if (message === null && pane) {
    text = statusText({
      total: pane.entries.length,
      totalBytes: pane.entries.reduce((n, e) => n + (e.size ?? 0), 0),
      selected: pane.selected.size,
      selectedBytes: selectedEntries(pane).reduce((n, e) => n + (e.size ?? 0), 0),
      disk: pane.disk,
    });
  }

  return (
    <div className="statusbar" onMouseDown={(e) => e.preventDefault()}>
      {updateReady && (
        <button
          type="button"
          className="status-update"
          title="クリックすると、更新して再起動します。このまま使い続けても、終了したときに更新します"
          onClick={() => void runCommand("System.Update")}
        >
          Vesta {updateReady} に更新
        </button>
      )}
      <div className="status-text">{text}</div>
      <div className="status-buttons">
        {status.map((item, i) => {
          if (isSeparator(item)) return <div key={i} className="status-sep" />;
          const enabled = item.command ? commandEnabled(item.command) : true;
          const checked = !!item.command && commandChecked(item.command);
          return (
            <button
              key={i}
              type="button"
              className={`status-btn${checked ? " pressed" : ""}`}
              title={item.text}
              disabled={!enabled}
              onClick={(e) => void runItem(item, modsOf(e))}
            >
              {item.image !== undefined ? (
                <CommandIcon index={item.image} size={16} disabled={!enabled} />
              ) : (
                <span className="status-btn-text">{item.text}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
