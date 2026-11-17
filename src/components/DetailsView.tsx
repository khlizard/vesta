// Details view. Spec: docs/spec/listing.md「詳細の列」

import { useCallback, useRef, useState } from "react";
import { iconUrl } from "../api/backend";
import type { Entry } from "../api/types";
import { cx, dragStarted } from "../model/input";
import { setOption } from "../state/options";
import {
  ALL_COLUMNS,
  COLUMN_LABEL,
  DEFAULT_COLUMNS,
  RIGHT_ALIGNED,
  dropIndex,
  moveShownColumn,
  toggleColumn,
  visibleColumns,
} from "../model/columns";
import type { SortKey } from "../model/sort";
import { setView } from "../state/tabActions";
import { cellText, fitWidth } from "../state/columns";
import { ordered } from "../state/selection";
import { getState, useStore } from "../state/store";
import { ListBase, type ViewProps } from "./pane/ListBase";
import { buildLayout } from "./pane/layout";
import { textMetrics } from "../model/fontSize";
import { RenameInput } from "./pane/RenameInput";
import { openPopup, type PopupItem } from "./popupBus";
import "../styles/pane.css";

const MIN_COL = 24;

const MENU_KEY: Record<SortKey, string> = {
  name: "N",
  status: "S",
  modified: "M",
  type: "T",
  size: "Z",
  created: "C",
  accessed: "A",
  attributes: "R",
};

/** Column widths are shared by all folders and panes (docs/spec/listing.md「列のカスタマイズ」). */
function setColumnWidth(key: SortKey, width: number) {
  void setOption("ColumnWidths", { ...getState().options.ColumnWidths, [key]: width });
}

/** Header context menu: show/hide columns (docs/spec/listing.md「列のカスタマイズ」). */
function openColumnMenu(x: number, y: number) {
  const columns = getState().options.Columns;
  const items: PopupItem[] = ALL_COLUMNS.map((key) => ({
    text: `${COLUMN_LABEL[key]}(_${MENU_KEY[key]})`,
    checked: columns.includes(key),
    disabled: key === "name",
    onSelect: () => void setOption("Columns", toggleColumn(getState().options.Columns, key)),
  }));
  items.push({ separator: true }, { text: "既定に戻す(_D)", onSelect: () => void setOption("Columns", [...DEFAULT_COLUMNS]) });
  openPopup(items, x, y);
}

function SyncIcon({ state }: { state: NonNullable<Entry["syncState"]> }) {
  if (state === "pinned") {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-label="常に利用可能">
        <circle cx="8" cy="8" r="7" fill="#2e9c3a" />
        <path d="M4.5 8.3l2.4 2.4 4.6-4.9" fill="none" stroke="#fff" strokeWidth="1.8" />
      </svg>
    );
  }
  if (state === "available") {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-label="利用可能">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="#2e9c3a" strokeWidth="1.2" />
        <path d="M4.8 8.3l2.2 2.2 4.2-4.5" fill="none" stroke="#2e9c3a" strokeWidth="1.4" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-label="オンラインのみ">
      <path
        d="M4.6 12.5h6.9a2.9 2.9 0 0 0 .4-5.77A4 4 0 0 0 4.2 7.1a2.7 2.7 0 0 0 .4 5.4z"
        fill="none"
        stroke="#1f6fd0"
        strokeWidth="1.2"
      />
    </svg>
  );
}


export function DetailsView({ id, pane, current }: ViewProps) {
  const fullRow = useStore((s) => s.options.FullRowSelect);
  const grid = useStore((s) => s.options.GridLine);
  const columns = useStore((s) => s.options.Columns);
  const cols = visibleColumns(columns, !!pane.folder?.syncRoot);
  const widths = useStore((s) => s.options.ColumnWidths);
  const { sortKey, sortDesc } = pane.view;
  const total = cols.reduce((n, c) => n + widths[c], 0);
  const ord = ordered(pane);
  const nameWidth = widths.name;
  const fontSize = useStore((s) => s.options.FontSize);
  // Rows and the header follow the text size (model/fontSize.ts).
  const ROW_H = textMetrics(fontSize).row;
  const HEAD_H = ROW_H;

  const layoutFor = useCallback(() => buildLayout(ord, 1, ROW_H, ROW_H), [ord, ROW_H]);
  const itemBox = () => ({ left: 0, width: fullRow ? total : nameWidth });

  const resizing = useRef<{ key: SortKey; x: number; w: number } | null>(null);
  const headRef = useRef<HTMLDivElement>(null);
  /** Header press that may become a column drag. */
  const moving = useRef<{ key: SortKey; x: number; dragging: boolean } | null>(null);
  /** The click that ends a column drag must not sort. */
  const swallowClick = useRef(false);
  /** Column being dragged and its insertion index into `cols` (shown as a line). */
  const [drag, setDrag] = useState<{ key: SortKey; at: number } | null>(null);

  const sortBy = (key: SortKey) =>
    setView(id, (v) => (v.sortKey === key ? { sortDesc: !v.sortDesc } : { sortKey: key, sortDesc: false }));

  const dropIndexAt = (clientX: number) => {
    const left = headRef.current?.getBoundingClientRect().left ?? 0;
    // Nothing goes left of the name column.
    return Math.max(1, dropIndex(cols.map((c) => widths[c]), clientX - left));
  };
  const dropLineLeft = drag === null ? 0 : cols.slice(0, drag.at).reduce((n, c) => n + widths[c], 0);

  const header = (
    <div
      ref={headRef}
      className="dhead"
      data-header=""
      style={{ width: total, height: HEAD_H }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openColumnMenu(e.clientX, e.clientY);
      }}
    >
      {cols.map((key) => (
        <div
          key={key}
          className={cx("hcell", RIGHT_ALIGNED.has(key) && "right", drag?.key === key && "moving")}
          style={{ width: widths[key] }}
          onClick={() => {
            if (swallowClick.current) {
              swallowClick.current = false;
              return;
            }
            sortBy(key);
          }}
          onPointerDown={(e) => {
            if (e.button !== 0 || key === "name") return;
            swallowClick.current = false;
            moving.current = { key, x: e.clientX, dragging: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const m = moving.current;
            if (!m) return;
            if (!m.dragging && !dragStarted(e.clientX - m.x, 0)) return;
            m.dragging = true;
            setDrag({ key: m.key, at: dropIndexAt(e.clientX) });
          }}
          onPointerUp={(e) => {
            const m = moving.current;
            moving.current = null;
            setDrag(null);
            if (!m?.dragging) return;
            swallowClick.current = true;
            const next = moveShownColumn(getState().options.Columns, cols, m.key, dropIndexAt(e.clientX));
            void setOption("Columns", next);
          }}
          onLostPointerCapture={() => {
            moving.current = null;
            setDrag(null);
          }}
        >
          <span className="hlabel">{COLUMN_LABEL[key]}</span>
          {sortKey === key && <span className="harrow">{sortDesc ? "▼" : "▲"}</span>}
          <div
            className="hresize"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              resizing.current = { key, x: e.clientX, w: widths[key] };
            }}
            onPointerMove={(e) => {
              const r = resizing.current;
              if (!r) return;
              const w = Math.max(MIN_COL, Math.round(r.w + e.clientX - r.x));
              setColumnWidth(r.key, w);
            }}
            onPointerUp={(e) => {
              resizing.current = null;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onLostPointerCapture={() => {
              resizing.current = null;
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              const w = fitWidth(key, pane.entries);
              setColumnWidth(key, w);
            }}
          />
        </div>
      ))}
      {drag !== null && <div className="hdrop" style={{ left: dropLineLeft - 1 }} />}
    </div>
  );

  const renderItem = (e: Entry) => {
    const selected = pane.selected.has(e.location);
    const isCursor = pane.cursor === e.location;
    const itemAttrs: Record<string, string | undefined> = {
      "data-item": e.location,
      "data-drop-folder": e.isFolder ? e.location : undefined,
    };
    const cell = (key: SortKey) => {
      switch (key) {
        case "name":
          return (
            <div
              key={key}
              className={cx("cell name", !fullRow && selected && "selected", !fullRow && isCursor && "cursor")}
              style={{ width: widths.name }}
              {...(fullRow ? {} : itemAttrs)}
            >
              <img className="icon" src={iconUrl(e.location, 16, e)} loading="lazy" draggable={false} alt="" />
              {pane.renaming === e.location ? (
                <RenameInput id={id} entry={e} />
              ) : (
                <span className="label">{e.name}</span>
              )}
            </div>
          );
        case "status":
          return (
            <div key={key} className="cell status" style={{ width: widths.status }}>
              {e.syncState && <SyncIcon state={e.syncState} />}
            </div>
          );
        default:
          return (
            <div key={key} className={cx("cell", RIGHT_ALIGNED.has(key) && "right")} style={{ width: widths[key] }}>
              {cellText[key](e)}
            </div>
          );
      }
    };
    return (
      <div
        key={e.location}
        className={cx("drow", fullRow && selected && "selected", fullRow && isCursor && "cursor", e.hidden && "dim")}
        style={{ width: total }}
        {...(fullRow ? itemAttrs : {})}
      >
        {cols.map(cell)}
      </div>
    );
  };

  return (
    <ListBase
      id={id}
      pane={pane}
      current={current}
      className={cx("details", grid && "grid", fullRow && "full")}
      headerHeight={HEAD_H}
      header={header}
      contentWidth={total}
      itemHeight={ROW_H}
      layoutFor={layoutFor}
      itemBox={itemBox}
      horizontalKeys={false}
      renderItem={renderItem}
    />
  );
}
