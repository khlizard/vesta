// Tool bar (tool.xml): 24px icons, flat buttons, split buttons and drop-downs.
import type { MouseEvent } from "react";
import { Ellipsis } from "lucide-react";
import { iconUrl } from "../api/backend";
import { commandChecked, commandEnabled } from "../commands/registry";
import { runItem } from "../commands/items";
import { toolContent } from "../config/icons";
import { useConfig } from "../config/store";
import type { MenuItem } from "../config/types";
import { modsOf } from "../model/input";
import { menuLabel } from "../model/menu";
import { useStore } from "../state/store";
import { CommandIcon } from "./CommandIcon";
import { isSeparator, openPopup, type PopupItem } from "./popupBus";
import "../styles/chrome.css";

function dropDown(e: MouseEvent<HTMLElement>, items: PopupItem[]) {
  const r = e.currentTarget.parentElement?.getBoundingClientRect() ?? e.currentTarget.getBoundingClientRect();
  openPopup(items, r.left, r.bottom);
}

function tooltip(item: MenuItem): string {
  return menuLabel(item.text).label || item.command || "";
}

function ToolButton({ item, mru }: { item: MenuItem; mru: string[] }) {
  const isMru = item.command === "File.MRU";
  const hasChildren = !!item.children?.length;
  const split = isMru || (hasChildren && !!item.command);
  const dropOnly = hasChildren && !item.command;
  const enabled = item.command ? commandEnabled(item.command) : true;
  const checked = !!item.command && commandChecked(item.command);

  const kind = toolContent(item.image, item.text);
  const content =
    kind === "icon" ? (
      <CommandIcon index={item.image!} size={24} disabled={!enabled} />
    ) : kind === "text" ? (
      <span className="tb-text">{item.text}</span>
    ) : (
      <Ellipsis className={enabled ? "cmd-icon" : "cmd-icon disabled"} size={24} strokeWidth={1.75} aria-hidden="true" />
    );

  const items = (): PopupItem[] =>
    isMru
      ? mru.map((loc) => ({ text: loc, literal: true, path: loc, iconSrc: iconUrl(loc) }))
      : (item.children ?? []);

  if (dropOnly) {
    return (
      <div className="tb-group">
        <button type="button" className="tb-btn tb-drop" title={tooltip(item)} onClick={(e) => dropDown(e, items())}>
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
        className={`tb-btn${checked ? " pressed" : ""}${split ? " tb-main" : ""}`}
        title={tooltip(item)}
        disabled={!enabled}
        onClick={(e) => void runItem(item, modsOf(e))}
        onAuxClick={(e) => {
          if (e.button === 1) void runItem(item, { ...modsOf(e), ctrl: true });
        }}
      >
        {content}
      </button>
      {split && (
        <button type="button" className="tb-btn tb-split" tabIndex={-1} onClick={(e) => dropDown(e, items())}>
          <span className="tb-arrow">▼</span>
        </button>
      )}
    </div>
  );
}

export function ToolBar() {
  const tool = useConfig((s) => s.tool);
  // Checked/enabled state is derived from the whole store, so re-render on any change.
  const mru = useStore((s) => s.mru);
  useStore();
  return (
    <div className="toolbar" onMouseDown={(e) => e.preventDefault()}>
      {tool.map((item, i) =>
        isSeparator(item) ? <div key={i} className="tb-sep" /> : <ToolButton key={i} item={item} mru={mru} />,
      )}
    </div>
  );
}
