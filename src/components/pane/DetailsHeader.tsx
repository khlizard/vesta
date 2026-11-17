// Column header of the details view: sorting, and moving and resizing the columns.
// Spec: docs/spec/listing.md「詳細の列」「列のカスタマイズ」

import { useRef, useState } from "react";
import { COLUMN_LABEL, RIGHT_ALIGNED, dropIndex } from "../../model/columns";
import { cx, dragStarted } from "../../model/input";
import type { SortKey } from "../../model/sort";
import { dispatch } from "../../root/dispatch";

const MIN_COL = 24;

interface Props {
  id: string;
  /** The columns drawn, in order. */
  columns: SortKey[];
  widths: Record<SortKey, number>;
  /** Sum of the widths of the columns drawn. */
  total: number;
  height: number;
  sortKey: SortKey;
  sortDesc: boolean;
}

export function DetailsHeader({ id, columns, widths, total, height, sortKey, sortDesc }: Props) {
  const resizing = useRef<{ key: SortKey; x: number; w: number } | null>(null);
  const headRef = useRef<HTMLDivElement>(null);
  /** Header press that may become a column drag. */
  const moving = useRef<{ key: SortKey; x: number; dragging: boolean } | null>(null);
  /** The click that ends a column drag must not sort. */
  const swallowClick = useRef(false);
  /** Column being dragged and its insertion index into `columns` (shown as a line). */
  const [drag, setDrag] = useState<{ key: SortKey; at: number } | null>(null);

  const dropIndexAt = (clientX: number) => {
    const left = headRef.current?.getBoundingClientRect().left ?? 0;
    // Nothing goes left of the name column.
    return Math.max(1, dropIndex(columns.map((c) => widths[c]), clientX - left));
  };
  const dropLineLeft = drag === null ? 0 : columns.slice(0, drag.at).reduce((n, c) => n + widths[c], 0);

  return (
    <div
      ref={headRef}
      className="dhead"
      data-header=""
      style={{ width: total, height }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dispatch({ type: "list.contextHeader", at: { x: e.clientX, y: e.clientY } });
      }}
    >
      {columns.map((key) => (
        <div
          key={key}
          className={cx("hcell", RIGHT_ALIGNED.has(key) && "right", drag?.key === key && "moving")}
          style={{ width: widths[key] }}
          onClick={() => {
            if (swallowClick.current) {
              swallowClick.current = false;
              return;
            }
            dispatch({ type: "list.sort", id, key });
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
            dispatch({ type: "list.moveColumn", id, key: m.key, to: dropIndexAt(e.clientX) });
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
              const width = Math.max(MIN_COL, Math.round(r.w + e.clientX - r.x));
              dispatch({ type: "list.columnWidth", key: r.key, width });
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
              dispatch({ type: "list.fitColumn", id, key });
            }}
          />
        </div>
      ))}
      {drag !== null && <div className="hdrop" style={{ left: dropLineLeft - 1 }} />}
    </div>
  );
}
