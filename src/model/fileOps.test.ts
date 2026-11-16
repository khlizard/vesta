import { describe, expect, it } from "vitest";
import { dropKind, resultMessage, transferOps } from "./fileOps";

const none = { ctrl: false, shift: false, alt: false };
const a = "C:/work/a.txt".replace(/\//g, "\\");
const b = "C:/work/b.txt".replace(/\//g, "\\");
const work = "C:/work".replace(/\//g, "\\");
const other = "C:/other".replace(/\//g, "\\");
const onD = "D:/backup".replace(/\//g, "\\");

describe("dropKind", () => {
  it("moves on the same drive and copies to another", () => {
    expect(dropKind([a], other, none, true)).toBe("move");
    expect(dropKind([a], onD, none, true)).toBe("copy");
  });

  it("moves to another drive when the option is off", () => {
    expect(dropKind([a], onD, none, false)).toBe("move");
  });

  it("copies when any of the items is on another drive", () => {
    expect(dropKind([a, "D:/x.txt".replace("/", "\\")], other, none, true)).toBe("copy");
  });

  it("follows the modifier keys before the drives", () => {
    expect(dropKind([a], other, { ...none, ctrl: true }, true)).toBe("copy");
    expect(dropKind([a], onD, { ...none, shift: true }, true)).toBe("move");
    expect(dropKind([a], other, { ...none, alt: true }, true)).toBe("link");
    expect(dropKind([a], other, { ...none, ctrl: true, shift: true }, true)).toBe("link");
  });
});

describe("transferOps", () => {
  it("copies or moves into another folder", () => {
    expect(transferOps("move", [a, b], other)).toEqual([{ kind: "move", sources: [a, b], dest: other }]);
    expect(transferOps("copy", [a], other)).toEqual([{ kind: "copy", sources: [a], dest: other }]);
  });

  it("does nothing when moving items into the folder they are in", () => {
    expect(transferOps("move", [a, b], work)).toEqual([]);
  });

  it("duplicates items copied into the folder they are in", () => {
    expect(transferOps("copy", [a], work)).toEqual([{ kind: "duplicate", sources: [a] }]);
  });

  it("treats a mix of both apart", () => {
    const far = "C:/far/c.txt".replace(/\//g, "\\");
    expect(transferOps("copy", [a, far], work)).toEqual([
      { kind: "copy", sources: [far], dest: work },
      { kind: "duplicate", sources: [a] },
    ]);
    expect(transferOps("move", [a, far], work)).toEqual([{ kind: "move", sources: [far], dest: work }]);
  });

  it("makes shortcuts wherever the items are", () => {
    expect(transferOps("link", [a], work)).toEqual([{ kind: "link", sources: [a], dest: work }]);
  });

  it("is empty without items", () => {
    expect(transferOps("copy", [], work)).toEqual([]);
  });
});

describe("resultMessage", () => {
  it("says nothing after a plain success", () => {
    expect(resultMessage({ aborted: false, done: true, replaced: false })).toBeNull();
  });

  it("tells a cancel apart from a partly done operation", () => {
    expect(resultMessage({ aborted: true, done: false, replaced: false })).toBe("操作を中止しました");
    expect(resultMessage({ aborted: true, done: true, replaced: false })).toBe("一部の項目は処理されませんでした");
  });

  it("says when replaced items are left out of undo", () => {
    expect(resultMessage({ aborted: false, done: true, replaced: true })).toContain("元に戻す対象になりません");
  });
});
