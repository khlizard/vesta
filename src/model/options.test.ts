import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS } from "../state/store";
import { normalizeOptions } from "./options";

const norm = (raw: unknown) => normalizeOptions(raw, DEFAULT_OPTIONS);

describe("normalizeOptions", () => {
  it("returns the defaults for anything that is not an object", () => {
    expect(norm(null)).toEqual(DEFAULT_OPTIONS);
    expect(norm("x")).toEqual(DEFAULT_OPTIONS);
    expect(norm([1])).toEqual(DEFAULT_OPTIONS);
  });

  it("keeps valid values", () => {
    const o = norm({ GridLine: !DEFAULT_OPTIONS.GridLine, Insert: "prev", ThumbnailSize: 192, FontSize: 16 });
    expect(o.GridLine).toBe(!DEFAULT_OPTIONS.GridLine);
    expect(o.Insert).toBe("prev");
    expect(o.ThumbnailSize).toBe(192);
    expect(o.FontSize).toBe(16);
  });

  it("accepts Avesta's capitalised Insert and rejects unknown ones", () => {
    expect(norm({ Insert: "Tail" }).Insert).toBe("tail");
    expect(norm({ Insert: "HEAD" }).Insert).toBe("head");
    expect(norm({ Insert: "middle" }).Insert).toBe(DEFAULT_OPTIONS.Insert);
    expect(norm({ Insert: 3 }).Insert).toBe(DEFAULT_OPTIONS.Insert);
  });

  it("falls back for wrong types and clamps sizes", () => {
    expect(norm({ GridLine: "yes" }).GridLine).toBe(DEFAULT_OPTIONS.GridLine);
    expect(norm({ MenuVisible: 0 }).MenuVisible).toBe(true);
    expect(norm({ ThumbnailSize: 10000 }).ThumbnailSize).toBe(512);
    expect(norm({ ThumbnailSize: "big" }).ThumbnailSize).toBe(DEFAULT_OPTIONS.ThumbnailSize);
    expect(norm({ FontSize: 99 }).FontSize).toBe(12);
  });

  it("drops removed options and repairs column widths", () => {
    const o = norm({ AlwaysTop: true, ColumnWidths: { name: 300, size: "wide", modified: 1, bogus: 5 } });
    expect("AlwaysTop" in o).toBe(false);
    expect(o.ColumnWidths.name).toBe(300);
    expect(o.ColumnWidths.size).toBe(DEFAULT_OPTIONS.ColumnWidths.size);
    expect(o.ColumnWidths.modified).toBe(24);
    expect("bogus" in o.ColumnWidths).toBe(false);
  });
});
