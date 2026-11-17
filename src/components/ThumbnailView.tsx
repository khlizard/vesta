// Thumbnail view. Spec: docs/spec/listing.md「表示モード」

import { useCallback } from "react";
import { iconUrl, thumbUrl } from "../api/backend";
import type { Entry } from "../api/types";
import { textMetrics } from "../model/fontSize";
import { cx } from "../model/input";
import { stepThumbnailSize } from "../model/thumbSize";
import { setOption } from "../state/options";
import { ordered } from "../state/selection";
import { getState, useStore } from "../state/store";
import { ListBase, type ViewProps } from "./pane/ListBase";
import { buildLayout } from "./pane/layout";
import { RenameInput } from "./pane/RenameInput";
import "../styles/pane.css";

const PAD = 4;
const CELL_PAD_X = 16;
const CELL_PAD_Y = 8;

export function ThumbnailView({ id, pane, current }: ViewProps) {
  const size = useStore((s) => s.options.ThumbnailSize);
  // The label and group header follow the text size (model/fontSize.ts).
  const text = textMetrics(useStore((s) => s.options.FontSize));
  const LABEL_H = text.thumbLabel;
  const GROUP_H = text.group;
  const ord = ordered(pane);
  const cellW = size + CELL_PAD_X;
  const cellH = size + CELL_PAD_Y + LABEL_H;

  const layoutFor = useCallback(
    (width: number) => buildLayout(ord, Math.floor((width - PAD * 2) / cellW), cellH, GROUP_H),
    [ord, cellW, cellH, GROUP_H],
  );
  const itemBox = useCallback((col: number) => ({ left: PAD + col * cellW, width: cellW }), [cellW]);

  const renderItem = (e: Entry, col: number) => {
    const selected = pane.selected.has(e.location);
    return (
      <div
        key={e.location}
        className={cx("tcell", selected && "selected", pane.cursor === e.location && "cursor", e.hidden && "dim")}
        style={{ left: PAD + col * cellW, width: cellW, height: cellH }}
        data-item={e.location}
        data-drop-folder={e.isFolder ? e.location : undefined}
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
        {pane.renaming === e.location ? <RenameInput id={id} entry={e} /> : <div className="tlabel">{e.name}</div>}
      </div>
    );
  };

  return (
    <ListBase
      id={id}
      pane={pane}
      current={current}
      className="thumbs"
      headerHeight={0}
      itemHeight={cellH}
      layoutFor={layoutFor}
      itemBox={itemBox}
      horizontalKeys
      renderItem={renderItem}
      onCtrlWheel={(dir) => void setOption("ThumbnailSize", stepThumbnailSize(getState().options.ThumbnailSize, dir))}
    />
  );
}
