// Details view. Spec: docs/spec/listing.md「詳細の列」

import { useCallback, useMemo } from "react";
import { iconUrl } from "../api/urls";
import { RIGHT_ALIGNED, cellText } from "../model/columns";
import { cx } from "../model/input";
import type { SortKey } from "../model/sort";
import { listView, type Entry } from "../presenters/list";
import { useView } from "../presenters/view";
import { DetailsHeader } from "./pane/DetailsHeader";
import { ListBase, type ViewProps } from "./pane/ListBase";
import { buildLayout } from "./pane/layout";
import { RenameInput } from "./pane/RenameInput";
import { SyncIcon } from "./pane/SyncIcon";
import "../styles/pane.css";

export function DetailsView({ id }: ViewProps) {
  const v = useView(useMemo(() => listView(id), [id]));
  const { ord, columns: cols, widths, totalWidth: total, fullRow } = v;
  // Rows and the header follow the text size (model/fontSize.ts).
  const ROW_H = v.rowHeight;
  const HEAD_H = ROW_H;

  const layoutFor = useCallback(() => buildLayout(ord, 1, ROW_H, ROW_H), [ord, ROW_H]);
  const itemBox = () => ({ left: 0, width: fullRow ? total : widths.name });

  const header = (
    <DetailsHeader
      id={id}
      columns={cols}
      widths={widths}
      total={total}
      height={HEAD_H}
      sortKey={v.sortKey}
      sortDesc={v.sortDesc}
    />
  );

  const renderItem = (e: Entry) => {
    const selected = v.selected.has(e.location);
    const isCursor = v.cursor === e.location;
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
              {v.renaming === e.location ? (
                <RenameInput id={id} entry={e} skipExt={v.renameSkipExt} />
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
      view={v}
      className={cx("details", v.gridLine && "grid", fullRow && "full")}
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
