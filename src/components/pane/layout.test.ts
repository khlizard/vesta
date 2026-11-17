import { describe, expect, it } from "vitest";
import type { Entry } from "../../api/types";
import { resizePair, resolveFractions, splitRows } from "./arrange";
import { buildLayout, marqueeHits, normalizeBox, revealScroll, visibleRange } from "./layout";

const entry = (name: string): Entry => ({
  name,
  location: `C:\\${name}`,
  isFolder: false,
  isLink: false,
  size: 1,
  modified: null,
  created: null,
  accessed: null,
  attributes: null,
  typeName: "",
  hidden: false,
  system: false,
  syncState: null,
});
const names = (n: number) => Array.from({ length: n }, (_, i) => entry(`f${i}`));

describe("buildLayout", () => {
  it("makes one row per item for details", () => {
    const l = buildLayout({ entries: names(3), groups: null }, 1, 20, 20);
    expect(l.rows.map((r) => r.top)).toEqual([0, 20, 40]);
    expect(l.height).toBe(60);
    expect(l.rowOf.get("C:\\f2")).toBe(2);
  });

  it("packs items into columns and inserts group rows", () => {
    const e = names(5);
    const l = buildLayout(
      {
        entries: e,
        groups: [
          { group: { key: "a", label: "A", order: 0 }, entries: e.slice(0, 3) },
          { group: { key: "b", label: "B", order: 1 }, entries: e.slice(3) },
        ],
      },
      2,
      100,
      20,
    );
    expect(l.rows.map((r) => r.kind)).toEqual(["group", "items", "items", "group", "items"]);
    expect(l.rows.map((r) => r.top)).toEqual([0, 20, 120, 220, 240]);
    expect(l.height).toBe(340);
    expect(l.rowOf.get("C:\\f2")).toBe(2);
  });

  it("treats zero columns as one", () => {
    expect(buildLayout({ entries: names(2), groups: null }, 0, 10, 10).rows).toHaveLength(2);
  });
});

describe("visibleRange", () => {
  const rows = buildLayout({ entries: names(10), groups: null }, 1, 20, 20).rows;
  it("returns rows intersecting the range", () => {
    expect(visibleRange(rows, 0, 40)).toEqual([0, 2]);
    expect(visibleRange(rows, 30, 70)).toEqual([1, 4]);
    expect(visibleRange(rows, 190, 1000)).toEqual([9, 10]);
  });
  it("is empty past the end or for an empty range", () => {
    expect(visibleRange(rows, 500, 600)).toEqual([10, 10]);
    expect(visibleRange(rows, 40, 40)[1]).toBeLessThanOrEqual(visibleRange(rows, 40, 40)[0]);
  });
});

describe("marqueeHits", () => {
  const layout = buildLayout({ entries: names(6), groups: null }, 3, 50, 20);
  const itemBox = (col: number) => ({ left: col * 100, width: 100 });
  it("selects intersecting cells", () => {
    expect(marqueeHits(layout, itemBox, normalizeBox(150, 10, 250, 20))).toEqual(["C:\\f1", "C:\\f2"]);
    expect(marqueeHits(layout, itemBox, normalizeBox(250, 80, 50, 40))).toEqual(["C:\\f0", "C:\\f1", "C:\\f2", "C:\\f3", "C:\\f4", "C:\\f5"]);
  });
  it("selects nothing in empty space", () => {
    expect(marqueeHits(layout, itemBox, normalizeBox(400, 10, 500, 90))).toEqual([]);
    expect(marqueeHits(layout, itemBox, normalizeBox(0, 500, 50, 600))).toEqual([]);
  });
});

describe("revealScroll", () => {
  it("scrolls the minimum distance", () => {
    expect(revealScroll(100, 20, 0, 80)).toBe(40);
    expect(revealScroll(10, 20, 50, 80)).toBe(10);
    expect(revealScroll(60, 20, 50, 80)).toBe(50);
  });
});

describe("pane arrangement", () => {
  it("keeps one row when off or within the limit", () => {
    expect(splitRows(20, false, 6)).toEqual([20, 0]);
    expect(splitRows(0, true, 6)).toEqual([0, 0]);
    expect(splitRows(6, true, 6)).toEqual([6, 0]);
  });
  it("splits evenly past the limit, the upper row taking the odd pane", () => {
    expect(splitRows(7, true, 6)).toEqual([4, 3]);
    expect(splitRows(8, true, 6)).toEqual([4, 4]);
    expect(splitRows(12, true, 6)).toEqual([6, 6]);
    expect(splitRows(13, true, 6)).toEqual([7, 6]);
    expect(splitRows(20, true, 6)).toEqual([10, 10]);
    expect(splitRows(2, true, 1)).toEqual([1, 1]);
    expect(splitRows(3, true, 0)).toEqual([2, 1]);
  });
  it("falls back to equal widths", () => {
    expect(resolveFractions(["a", "b"], null)).toEqual([0.5, 0.5]);
    expect(resolveFractions(["a", "b"], { a: 1 })).toEqual([0.5, 0.5]);
  });
  it("normalises saved fractions", () => {
    expect(resolveFractions(["a", "b"], { a: 1, b: 3 })).toEqual([0.25, 0.75]);
  });
  it("resizes only the two neighbours and respects the minimum", () => {
    const f = [0.25, 0.25, 0.5];
    const r = resizePair(f, 0, 0.1, 0.05);
    expect(r[0]).toBeCloseTo(0.35);
    expect(r[1]).toBeCloseTo(0.15);
    expect(r[2]).toBe(0.5);
    const clamped = resizePair(f, 0, 1, 0.05);
    expect(clamped[1]).toBeCloseTo(0.05);
    expect(clamped[0] + clamped[1]).toBeCloseTo(0.5);
    expect(resizePair(f, 2, 0.1, 0.05)).toBe(f);
  });
});
