// What a pane's list draws (details and thumbnail views).
// Specs: docs/spec/listing.md, docs/spec/ui.md「モード」

import { visibleColumns } from "../model/columns";
import { takesDrop, type RenamePart } from "../model/fileOps";
import { textMetrics } from "../model/fontSize";
import type { SortKey } from "../model/sort";
import { ordered, type Ordered } from "../state/selection";
import { emptyPane, modeIn } from "../state/store";
import { presenter, type Presenter } from "./view";

// The item type, for the views (they do not import from the backend's side themselves).
import type { Entry } from "../api/types";
export type { Entry };
export type { Ordered } from "../state/selection";

/**
 * What marks a listed item for drops (root/drop.ts finds what is under the pointer by these):
 * a folder takes the dropped files in, a program or a shortcut is handed them.
 */
export function dropMarks(e: Entry): { "data-drop-folder"?: string; "data-drop-file"?: string } {
  if (e.isFolder) return { "data-drop-folder": e.location };
  return takesDrop(e) ? { "data-drop-file": e.location } : {};
}

export interface ListModel {
  /** The items in display order, and their groups when grouping is on. */
  ord: Ordered;
  selected: Set<string>;
  cursor: string | null;
  /** Item being renamed in place. */
  renaming: string | null;
  sortKey: SortKey;
  sortDesc: boolean;

  /** Details: the columns drawn, in order (`status` only under a sync root). */
  columns: SortKey[];
  /** Width (px) of every column, drawn or not. */
  widths: Record<SortKey, number>;
  /** Sum of the widths of the columns drawn. */
  totalWidth: number;
  fullRow: boolean;
  gridLine: boolean;

  // Heights (px) that follow the text size (model/fontSize.ts).
  /** Detail rows and the details header. */
  rowHeight: number;
  /** Group headers of the thumbnail view. */
  groupHeight: number;
  /** The label under a thumbnail. */
  thumbLabelHeight: number;
  /** Edge of a thumbnail (px). */
  thumbSize: number;

  /** The part of the name selected in the rename box. */
  renamePart: RenamePart;

  current: boolean;
  /** Location of the folder shown: the list goes back to its top when it changes. */
  folder: string | null;
  loading: boolean;

  /** Changes (to another number than 0) when the list is asked to take the keyboard focus. */
  focusSeq: number;
  /** The list takes the focus by itself when its folder has been loaded: nothing is in front of it. */
  wantsFocus: boolean;
}

/** Stands in for a pane that is gone while its view is still mounted. */
const NO_PANE = emptyPane();

/** The presenter of the list of pane `id`. Keep it per view (`useMemo`): it remembers its last result. */
export function listView(id: string): Presenter<ListModel> {
  return presenter(
    ({ app }) => {
      const o = app.options;
      const f = app.focus;
      return [
        app.panes[id],
        o.Columns,
        o.ColumnWidths,
        o.FullRowSelect,
        o.GridLine,
        o.FontSize,
        o.ThumbnailSize,
        app.tabs.currentId === id,
        f && f.paneId === id && f.target === "list" ? f.seq : 0,
        modeIn(app).kind === "idle",
      ] as const;
    },
    (pane, optColumns, widths, fullRow, gridLine, fontSize, thumbSize, current, focusSeq, idle) => {
      const p = pane ?? NO_PANE;
      const columns = visibleColumns(optColumns, !!p.folder?.syncRoot);
      const text = textMetrics(fontSize);
      return {
        ord: ordered(p),
        selected: p.selected,
        cursor: p.cursor,
        renaming: p.renaming,
        sortKey: p.view.sortKey,
        sortDesc: p.view.sortDesc,
        columns,
        widths,
        totalWidth: columns.reduce((n, c) => n + widths[c], 0),
        fullRow,
        gridLine,
        rowHeight: text.row,
        groupHeight: text.group,
        thumbLabelHeight: text.thumbLabel,
        thumbSize,
        renamePart: p.renamePart,
        current,
        folder: p.folder?.location ?? null,
        loading: p.loading,
        focusSeq,
        wantsFocus: !!pane && current && !p.loading && idle,
      };
    },
  );
}
