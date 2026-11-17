// Column width adjustment (AdjustToItem / AdjustToWindow).

import type { Entry } from "../api/types";
import { cellText, COLUMN_LABEL, visibleColumns } from "../model/columns";
import type { SortKey } from "../model/sort";
import { setOption } from "./options";
import { getState } from "./store";

const FONT_FAMILY = '"Yu Gothic UI", "Meiryo UI", sans-serif';
const PADDING = 18;
const ICON = 22;
/** Space left of the file icon in the name column (pane.css `.cell .icon`), in em. */
const ICON_MARGIN_EM = 0.2;

/** CSS font shorthand of the list at `fontSize` px (what the canvas measures with). */
export function listFont(fontSize: number): string {
  return `${fontSize}px ${FONT_FAMILY}`;
}

let ctx: CanvasRenderingContext2D | null = null;
/** Width of `text` in the list font at the current text size (FontSize option). */
function measure(text: string, fontSize: number): number {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * fontSize * 0.6;
  ctx.font = listFont(fontSize);
  return ctx.measureText(text).width;
}

/** Columns drawn for a pane, from the `Columns` option. */
export function paneColumns(syncRoot: boolean): SortKey[] {
  return visibleColumns(getState().options.Columns, syncRoot);
}

export function fitWidth(key: SortKey, entries: Entry[]): number {
  if (key === "status") return 48;
  const fontSize = getState().options.FontSize;
  let w = measure(COLUMN_LABEL[key], fontSize);
  const f = cellText[key];
  for (const e of entries.slice(0, 5000)) w = Math.max(w, measure(f(e), fontSize));
  return Math.ceil(w + PADDING + (key === "name" ? ICON + ICON_MARGIN_EM * fontSize : 0));
}

/**
 * AdjustToItem / AdjustToWindow. Widths are shared by all panes (docs/spec/listing.md「列のカスタマイズ」):
 * "item" fits each column to the widest content of the given panes; "window" fits the name column
 * to the first given pane (the current one when it is among them).
 */
export function adjustColumns(ids: string[], how: "item" | "window") {
  const { panes, options, tabs, layout } = getState();
  const listed = ids.filter((id) => panes[id]);
  if (!listed.length) return;
  const widths = { ...options.ColumnWidths };
  if (how === "item") {
    const cols = new Set(listed.flatMap((id) => paneColumns(!!panes[id].folder?.syncRoot)));
    const entries = listed.flatMap((id) => panes[id].entries);
    for (const c of cols) widths[c] = fitWidth(c, entries);
  } else {
    const id = listed.find((x) => x === tabs.currentId) ?? listed[0];
    const cols = paneColumns(!!panes[id].folder?.syncRoot);
    const total = layout.listWidths[id] ?? 600;
    const others = cols.filter((c) => c !== "name").reduce((n, c) => n + widths[c], 0);
    widths.name = Math.max(80, total - others - 20);
  }
  void setOption("ColumnWidths", widths);
}
