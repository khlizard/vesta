// What the pane area draws: the shown tabs' panes in one or two rows, with their sizes.
// Spec: docs/spec/tabs.md「ペインの配置」

import { resolveFractions, splitRows } from "../model/arrange";
import { shownTabs } from "../model/tabs";
import { presenter, sameFields } from "./view";

export interface PaneRowView {
  /** Ids of the row's panes (tab ids), left to right. */
  ids: string[];
  /** Width of each pane as a fraction of the row (they sum to 1). */
  fractions: number[];
  /** Height of the row as a fraction of the area (1 when it is the only row). */
  height: number;
}

export interface PaneAreaView {
  rows: PaneRowView[];
  /** Height fraction of the upper row; what a drag of the border between the rows starts from. */
  split: number;
}

export const paneAreaView = presenter(
  (s) => [s.app.tabs, s.app.options.TwoRows, s.app.options.TwoRowsMax, s.app.paneWidths, s.app.paneRowSplit] as const,
  (tabs, twoRows, rowMax, widths, rowSplit): PaneAreaView => {
    const ids = shownTabs(tabs).map((t) => t.id);
    const [top, bottom] = splitRows(ids.length, twoRows, rowMax);
    const parts = bottom > 0 ? [ids.slice(0, top), ids.slice(top)] : [ids];
    const split = rowSplit ?? 0.5;
    return {
      rows: parts.map((rowIds, r) => ({
        ids: rowIds,
        // The rows keep their widths apart: fractions are normalised per row.
        fractions: resolveFractions(rowIds, widths),
        height: parts.length < 2 ? 1 : r === 0 ? split : 1 - split,
      })),
      split,
    };
  },
  // `tabs` is another value whenever the current tab or a tab's folder changes; the arrangement seldom is.
  sameFields,
);
