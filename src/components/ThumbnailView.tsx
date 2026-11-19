// Thumbnail view. Spec: docs/spec/listing.md「表示モード」

import { useCallback, useMemo } from "react";
import { iconUrl, thumbUrl } from "../api/urls";
import { cx } from "../model/input";
import { dropMarks, listView, type Entry } from "../presenters/list";
import { useView } from "../presenters/view";
import { ListBase, type ViewProps } from "./pane/ListBase";
import { buildLayout } from "./pane/layout";
import { RenameInput } from "./pane/RenameInput";
import "../styles/pane.css";

const PAD = 4;
const CELL_PAD_X = 16;
const CELL_PAD_Y = 8;

export function ThumbnailView({ id }: ViewProps) {
  const v = useView(useMemo(() => listView(id), [id]));
  const { ord, thumbSize: size } = v;
  // The label and group header follow the text size (model/fontSize.ts).
  const LABEL_H = v.thumbLabelHeight;
  const GROUP_H = v.groupHeight;
  const cellW = size + CELL_PAD_X;
  const cellH = size + CELL_PAD_Y + LABEL_H;

  const layoutFor = useCallback(
    (width: number) => buildLayout(ord, Math.floor((width - PAD * 2) / cellW), cellH, GROUP_H),
    [ord, cellW, cellH, GROUP_H],
  );
  const itemBox = useCallback((col: number) => ({ left: PAD + col * cellW, width: cellW }), [cellW]);

  const renderItem = (e: Entry, col: number) => {
    const selected = v.selected.has(e.location);
    return (
      <div
        key={e.location}
        className={cx("tcell", selected && "selected", v.cursor === e.location && "cursor", e.hidden && "dim")}
        style={{ left: PAD + col * cellW, width: cellW, height: cellH }}
        data-item={e.location}
        {...dropMarks(e)}
      >
        <div className="timg" style={{ width: size, height: size }}>
          <img
            src={thumbUrl(e.location, size, e)}
            loading="lazy"
            draggable={false}
            alt=""
            onError={(ev) => {
              const img = ev.currentTarget;
              if (img.dataset.fallback) return;
              img.dataset.fallback = "1";
              img.src = iconUrl(e.location, 32, e);
              img.classList.add("fallback");
            }}
          />
        </div>
        {v.renaming === e.location ? (
          <RenameInput id={id} entry={e} part={v.renamePart} />
        ) : (
          <div className="tlabel">{e.name}</div>
        )}
      </div>
    );
  };

  return (
    <ListBase
      id={id}
      view={v}
      className="thumbs"
      headerHeight={0}
      itemHeight={cellH}
      layoutFor={layoutFor}
      itemBox={itemBox}
      horizontalKeys
      renderItem={renderItem}
    />
  );
}
