import { describe, expect, it } from "vitest";
import {
  clickSelect,
  contextSelect,
  edgeScrollSpeed,
  isTyping,
  keyStep,
  moveSelect,
  openTargets,
  pageStep,
  prefixTarget,
  pressOnItem,
  toggleAtCursor,
  typeLetter,
  type Sel,
} from "./selection";

const order = ["a", "b", "c", "d", "e"];
const sel = (selected: string[], cursor: string | null = null, anchor: string | null = cursor): Sel => ({
  selected: new Set(selected),
  cursor,
  anchor,
});
const picked = (s: Partial<Sel>) => [...(s.selected ?? [])].sort();
const none = { ctrl: false, shift: false };
const ctrl = { ctrl: true, shift: false };
const shift = { ctrl: false, shift: true };

describe("clickSelect", () => {
  it("selects only the clicked item", () => {
    const r = clickSelect(sel(["a", "b"], "a"), order, "c", none);
    expect(picked(r)).toEqual(["c"]);
    expect(r.cursor).toBe("c");
    expect(r.anchor).toBe("c");
  });

  it("toggles with Ctrl and moves the anchor", () => {
    const on = clickSelect(sel(["a"], "a"), order, "c", ctrl);
    expect(picked(on)).toEqual(["a", "c"]);
    expect(on.anchor).toBe("c");
    expect(picked(clickSelect(sel(["a", "c"], "a"), order, "c", ctrl))).toEqual(["a"]);
  });

  it("selects the range from the anchor with Shift, in either direction, keeping the anchor", () => {
    const down = clickSelect(sel(["b"], "b"), order, "d", shift);
    expect(picked(down)).toEqual(["b", "c", "d"]);
    expect(down.cursor).toBe("d");
    expect(down.anchor).toBeUndefined();
    expect(picked(clickSelect(sel(["d"], "d"), order, "b", shift))).toEqual(["b", "c", "d"]);
  });

  it("adds the range with Ctrl+Shift", () => {
    expect(picked(clickSelect(sel(["a", "c"], "c"), order, "e", { ctrl: true, shift: true }))).toEqual([
      "a",
      "c",
      "d",
      "e",
    ]);
  });

  it("treats Shift without a usable anchor as a plain click", () => {
    expect(picked(clickSelect(sel([]), order, "c", shift))).toEqual(["c"]);
    expect(picked(clickSelect(sel(["x"], "x", "gone"), order, "c", shift))).toEqual(["c"]);
  });
});

describe("contextSelect", () => {
  it("keeps a selection that holds the item", () => {
    const r = contextSelect(sel(["a", "b"], "a"), "b");
    expect(r.selected).toBeUndefined();
    expect(r.cursor).toBe("b");
  });

  it("selects only an item outside the selection, and clears on empty space", () => {
    expect(picked(contextSelect(sel(["a", "b"], "a"), "c"))).toEqual(["c"]);
    expect(picked(contextSelect(sel(["a", "b"], "a"), null))).toEqual([]);
  });
});

describe("pressOnItem / openTargets", () => {
  it("waits only when a selected item is pressed without modifiers", () => {
    const s = sel(["a", "b"], "a");
    expect(pressOnItem(s, "b", none)).toBe("wait");
    expect(pressOnItem(s, "b", ctrl)).toBe("select");
    expect(pressOnItem(s, "b", shift)).toBe("select");
    expect(pressOnItem(s, "c", none)).toBe("select");
  });

  it("opens the selection when the item is in it, else the item", () => {
    const a = { location: "a" };
    const b = { location: "b" };
    const c = { location: "c" };
    expect(openTargets([a, b], b, "b")).toEqual([a, b]);
    expect(openTargets([a, b], c, "c")).toEqual([c]);
    expect(openTargets([a], undefined, "gone")).toEqual([]);
  });
});

describe("keyStep / pageStep", () => {
  const list = { columns: 1, page: 9, horizontal: false };
  const grid = { columns: 4, page: 8, horizontal: true };

  it("moves by a row, a page, or to the ends", () => {
    expect(keyStep("ArrowDown", list)).toBe(1);
    expect(keyStep("ArrowUp", grid)).toBe(-4);
    expect(keyStep("PageDown", grid)).toBe(8);
    expect(keyStep("PageUp", list)).toBe(-9);
    expect(keyStep("Home", list)).toBe("home");
    expect(keyStep("End", list)).toBe("end");
  });

  it("uses Left/Right only where items sit side by side", () => {
    expect(keyStep("ArrowRight", grid)).toBe(1);
    expect(keyStep("ArrowLeft", grid)).toBe(-1);
    expect(keyStep("ArrowRight", list)).toBeNull();
    expect(keyStep("a", list)).toBeNull();
  });

  it("pages by one row less than fits, at least one row", () => {
    expect(pageStep(200, 20, 1)).toBe(9);
    expect(pageStep(200, 100, 4)).toBe(4);
    expect(pageStep(0, 20, 3)).toBe(3);
  });
});

describe("moveSelect", () => {
  it("moves and selects the item, clamped to the ends", () => {
    expect(picked(moveSelect(sel(["b"], "b"), order, 1, none))).toEqual(["c"]);
    expect(moveSelect(sel(["b"], "b"), order, -9, none).cursor).toBe("a");
    expect(moveSelect(sel(["b"], "b"), order, "end", none).cursor).toBe("e");
    expect(moveSelect(sel(["b"], "b"), order, "home", none).cursor).toBe("a");
  });

  it("starts from the near end when there is no cursor", () => {
    expect(moveSelect(sel([]), order, 1, none).cursor).toBe("a");
    expect(moveSelect(sel([]), order, -1, none).cursor).toBe("e");
  });

  it("moves only the cursor with Ctrl", () => {
    const r = moveSelect(sel(["b"], "b"), order, 2, ctrl);
    expect(r).toEqual({ cursor: "d" });
  });

  it("extends from the anchor with Shift", () => {
    const r = moveSelect(sel(["c"], "c"), order, 2, shift);
    expect(picked(r)).toEqual(["c", "d", "e"]);
    expect(r.anchor).toBe("c");
    const back = moveSelect({ ...sel(["c", "d", "e"], "e"), anchor: "c" }, order, -3, shift);
    expect(picked(back)).toEqual(["b", "c"]);
  });

  it("does nothing in an empty list", () => {
    expect(moveSelect(sel([]), [], 1, none)).toEqual({});
  });
});

describe("toggleAtCursor", () => {
  it("toggles the cursor item and anchors there", () => {
    const r = toggleAtCursor(sel(["a"], "b"));
    expect(picked(r)).toEqual(["a", "b"]);
    expect(r.anchor).toBe("b");
    expect(picked(toggleAtCursor(sel(["a", "b"], "b")))).toEqual(["a"]);
    expect(toggleAtCursor(sel(["a"]))).toEqual({});
  });
});

describe("type-ahead", () => {
  const items = [
    { location: "1", name: "alpha" },
    { location: "2", name: "Beta" },
    { location: "3", name: "bravo" },
    { location: "4", name: "charlie" },
  ];

  it("finds the next match after the cursor, wrapping, ignoring case", () => {
    expect(prefixTarget(items, null, "b")).toBe("2");
    expect(prefixTarget(items, "2", "b")).toBe("3");
    expect(prefixTarget(items, "3", "b")).toBe("2");
    expect(prefixTarget(items, "4", "A")).toBe("1");
    expect(prefixTarget(items, "1", "z")).toBeNull();
    expect(prefixTarget([], null, "a")).toBeNull();
  });

  it("adds letters typed within a second, and starts over after it", () => {
    const first = typeLetter({ text: "", at: 0 }, "b", 5000, "alpha");
    expect(first).toEqual({ next: { text: "b", at: 5000 }, prefix: "b" });
    const second = typeLetter(first.next, "r", 5400, "Beta");
    expect(second).toEqual({ next: { text: "br", at: 5400 }, prefix: "br" });
    const late = typeLetter(second.next, "c", 7000, "bravo");
    expect(late).toEqual({ next: { text: "c", at: 7000 }, prefix: "c" });
  });

  it("cycles when one letter is repeated", () => {
    const r = typeLetter({ text: "b", at: 1000 }, "b", 1200, "Beta");
    expect(r.next.text).toBe("bb");
    expect(r.prefix).toBe("b");
  });

  it("stays put when the cursor already matches what was typed", () => {
    const r = typeLetter({ text: "b", at: 1000 }, "r", 1200, "Bravo");
    expect(r.prefix).toBeNull();
    expect(r.next.text).toBe("br");
  });

  it("knows whether typing is still going on", () => {
    expect(isTyping({ text: "a", at: 1000 }, 1500)).toBe(true);
    expect(isTyping({ text: "a", at: 1000 }, 2000)).toBe(false);
    expect(isTyping({ text: "", at: 1000 }, 1001)).toBe(false);
  });
});

describe("edgeScrollSpeed", () => {
  it("grows with the distance up to a limit", () => {
    expect(edgeScrollSpeed(0)).toBe(3);
    expect(edgeScrollSpeed(30)).toBe(13);
    expect(edgeScrollSpeed(1000)).toBe(40);
  });
});
