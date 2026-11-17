// Checking the options read from config.json. Spec: docs/spec/config.md「config.json のオプション」
//
// The file can be hand-edited or come from another version, so every value is checked against
// the default's type; anything else falls back to the default instead of reaching the app.

import { normalizeColumns } from "./columns";
import { normalizeFontSize } from "./fontSize";

const INSERT = ["head", "tail", "prev", "next"];
const THUMB_RANGE = [64, 512];
const ROW_RANGE = [1, 50];
const MIN_COLUMN_WIDTH = 24;

/**
 * `defaults` with the usable values of `raw` on top. Keys `defaults` does not have are dropped
 * (options removed in a later version).
 */
export function normalizeOptions<T extends object>(raw: unknown, defaults: T): T {
  const saved = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const base = defaults as Record<string, unknown>;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(defaults)) {
    const v = saved[key];
    const d = base[key];
    if (key === "Columns") out[key] = normalizeColumns(v);
    else if (key === "FontSize") out[key] = normalizeFontSize(v);
    else if (key === "ColumnWidths") out[key] = widths(v, d as Record<string, number>);
    else if (key === "Insert") {
      // Avesta writes these capitalised ("Tail").
      const s = typeof v === "string" ? v.toLowerCase() : "";
      if (INSERT.includes(s)) out[key] = s;
    } else if (key === "ThumbnailSize") {
      if (typeof v === "number" && Number.isFinite(v)) {
        out[key] = Math.min(THUMB_RANGE[1], Math.max(THUMB_RANGE[0], Math.round(v)));
      }
    } else if (key === "TwoRowsMax") {
      if (typeof v === "number" && Number.isFinite(v)) {
        out[key] = Math.min(ROW_RANGE[1], Math.max(ROW_RANGE[0], Math.round(v)));
      }
    } else if (typeof d === "boolean") {
      if (typeof v === "boolean") out[key] = v;
    } else if (typeof v === typeof d && v !== null) {
      out[key] = v;
    }
  }
  return out as T;
}

/** Saved column widths over the defaults: only known columns, only sensible numbers. */
function widths(raw: unknown, defaults: Record<string, number>): Record<string, number> {
  const saved = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const v = saved[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = Math.max(MIN_COLUMN_WIDTH, Math.round(v));
  }
  return out;
}
