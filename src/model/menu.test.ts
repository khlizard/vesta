import { describe, expect, it } from "vitest";
import { accessKeyTarget, barItemFor, endSelectable, menuBarKey, nextSelectable, placeMenu } from "./menu";

// Items 1 and 3 cannot be selected (a separator and a disabled item).
const ok = (i: number) => i !== 1 && i !== 3;
const never = () => false;

describe("nextSelectable / endSelectable", () => {
  it("skips items that cannot be selected and wraps round", () => {
    expect(nextSelectable(5, 0, 1, ok)).toBe(2);
    expect(nextSelectable(5, 2, 1, ok)).toBe(4);
    expect(nextSelectable(5, 4, 1, ok)).toBe(0);
    expect(nextSelectable(5, 0, -1, ok)).toBe(4);
    expect(nextSelectable(5, 2, -1, ok)).toBe(0);
  });

  it("starts from the near end when nothing is selected", () => {
    expect(nextSelectable(5, -1, 1, ok)).toBe(0);
    expect(nextSelectable(5, -1, -1, (i) => i !== 4)).toBe(3);
  });

  it("stays where it is when nothing can be selected", () => {
    expect(nextSelectable(3, 1, 1, never)).toBe(1);
    expect(nextSelectable(0, -1, 1, ok)).toBe(-1);
  });

  it("finds the first and the last selectable item", () => {
    expect(endSelectable(5, 1, (i) => i !== 0)).toBe(1);
    expect(endSelectable(5, -1, (i) => i !== 4)).toBe(3);
    expect(endSelectable(3, 1, never)).toBe(-1);
  });
});

describe("accessKeyTarget", () => {
  const keys = ["a", null, "b", "b", "b"];

  it("runs the only match", () => {
    expect(accessKeyTarget(keys, "a", -1, ok)).toEqual({ run: 0 });
    expect(accessKeyTarget(["x", "y"], "y", 0, () => true)).toEqual({ run: 1 });
  });

  it("moves through several matches, leaving out the ones that cannot be selected", () => {
    expect(accessKeyTarget(keys, "b", -1, ok)).toEqual({ select: 2 });
    expect(accessKeyTarget(keys, "b", 2, ok)).toEqual({ select: 4 });
    expect(accessKeyTarget(keys, "b", 4, ok)).toEqual({ select: 2 });
  });

  it("is nothing without a match", () => {
    expect(accessKeyTarget(keys, "z", 0, ok)).toBeNull();
    expect(accessKeyTarget(keys, "a", 0, never)).toBeNull();
  });
});

describe("menuBarKey", () => {
  const keys = ["f", "e", null, "v"];

  it("moves along the bar, wrapping", () => {
    expect(menuBarKey(0, keys, "ArrowRight", false)).toEqual({ hot: 1 });
    expect(menuBarKey(3, keys, "ArrowRight", false)).toEqual({ hot: 0 });
    expect(menuBarKey(0, keys, "ArrowLeft", false)).toEqual({ hot: 3 });
  });

  it("opens the highlighted menu, or the one with the access key", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Enter"]) expect(menuBarKey(1, keys, key, false)).toEqual({ open: 1 });
    expect(menuBarKey(0, keys, "V", false)).toEqual({ open: 3 });
  });

  it("leaves on Escape and ignores what it does not know", () => {
    expect(menuBarKey(1, keys, "Escape", false)).toEqual({ leave: true });
    expect(menuBarKey(1, keys, "x", false)).toBeNull();
    expect(menuBarKey(1, keys, "v", true)).toBeNull();
    expect(menuBarKey(1, keys, "F5", false)).toBeNull();
    expect(menuBarKey(0, [], "ArrowRight", false)).toBeNull();
  });

  it("finds the bar item of a letter", () => {
    expect(barItemFor(keys, "E", false)).toBe(1);
    expect(barItemFor(keys, "e", true)).toBe(-1);
    expect(barItemFor(keys, "Enter", false)).toBe(-1);
  });
});

describe("placeMenu", () => {
  const size = { width: 100, height: 200 };
  const view = { width: 800, height: 600 };

  it("stays where asked when it fits", () => {
    expect(placeMenu({ x: 10, y: 20 }, size, view)).toEqual({ left: 10, top: 20 });
  });

  it("moves against the right edge, or to the left of the parent item", () => {
    expect(placeMenu({ x: 750, y: 20 }, size, view)).toEqual({ left: 700, top: 20 });
    expect(placeMenu({ x: 750, y: 20 }, size, view, 600)).toEqual({ left: 502, top: 20 });
    expect(placeMenu({ x: 750, y: 20 }, size, view, 50)).toEqual({ left: 0, top: 20 });
  });

  it("moves up when it would pass the bottom", () => {
    expect(placeMenu({ x: 10, y: 500 }, size, view)).toEqual({ left: 10, top: 400 });
    expect(placeMenu({ x: 10, y: 500 }, { width: 100, height: 900 }, view)).toEqual({ left: 10, top: 0 });
  });
});
