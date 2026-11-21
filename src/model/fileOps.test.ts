import { describe, expect, it } from "vitest";
import {
  copiedMessage,
  copyLines,
  dropKind,
  nextRenamePart,
  nextShown,
  pasteDest,
  renameSelection,
  renameTo,
  resultMessage,
  takesDrop,
  transferOps,
} from "./fileOps";

describe("takesDrop", () => {
  const item = (name: string, more: Partial<{ isFolder: boolean; isLink: boolean }> = {}) => ({
    name,
    isFolder: false,
    isLink: false,
    ...more,
  });

  it("is true for programs, scripts and shortcuts", () => {
    for (const name of ["a.exe", "run.BAT", "x.cmd", "old.com", "s.vbs", "s.js", "s.wsf"])
      expect(takesDrop(item(name))).toBe(true);
    expect(takesDrop(item("_MF勤怠 to  FX2.bat.lnk", { isLink: true }))).toBe(true);
  });

  it("is false for other files, and for folders (which are drop targets of their own kind)", () => {
    for (const name of ["a.txt", "readme", ".bat", "a.exe.bak"]) expect(takesDrop(item(name))).toBe(false);
    expect(takesDrop(item("tools.exe", { isFolder: true }))).toBe(false);
  });
});

describe("pasteDest", () => {
  const dir = { location: "C:\\work\\sub", isFolder: true };
  const file = { location: "C:\\work\\a.txt", isFolder: false };

  it("is the pane's folder unless PasteInFolder has one folder selected", () => {
    expect(pasteDest("C:\\work", [dir], false)).toBe("C:\\work");
    expect(pasteDest("C:\\work", [dir], true)).toBe("C:\\work\\sub");
    expect(pasteDest("C:\\work", [file], true)).toBe("C:\\work");
    expect(pasteDest("C:\\work", [dir, file], true)).toBe("C:\\work");
    expect(pasteDest("C:\\work", [], true)).toBe("C:\\work");
  });
});

describe("nextShown", () => {
  it("is the pane to the right, wrapping", () => {
    expect(nextShown(["a", "b", "c"], "a")).toBe("b");
    expect(nextShown(["a", "b", "c"], "c")).toBe("a");
  });

  it("is nothing with a single pane, and the first pane when the current one is not shown", () => {
    expect(nextShown(["a"], "a")).toBeNull();
    expect(nextShown(["a", "b"], null)).toBe("a");
    expect(nextShown(["a", "b"], "x")).toBe("a");
  });
});

describe("copyLines / copiedMessage", () => {
  const locs = ["C:\\work\\a.tar.gz", "C:\\work\\.gitignore", "C:\\work\\readme"];
  const unknown = () => undefined;

  it("gives paths, names, or names without the extension", () => {
    expect(copyLines(locs, "path", unknown)).toEqual(locs);
    expect(copyLines(locs, "name", unknown)).toEqual(["a.tar.gz", ".gitignore", "readme"]);
    expect(copyLines(locs, "base", unknown)).toEqual(["a.tar", ".gitignore", "readme"]);
  });

  it("prefers the listed name (virtual items have no path to take it from)", () => {
    expect(copyLines(["::{GUID}"], "name", () => "ごみ箱")).toEqual(["ごみ箱"]);
  });

  it("names the first line and counts the rest", () => {
    expect(copiedMessage(["a"])).toBe("a をコピーしました");
    expect(copiedMessage(["a", "b", "c"])).toBe("a ほか 2 件 をコピーしました");
  });
});

describe("renameSelection / nextRenamePart", () => {
  it("selects the name without its extension, the extension, or everything", () => {
    expect(renameSelection("報告.txt", false, "base")).toEqual([0, 2]);
    expect(renameSelection("報告.txt", false, "ext")).toEqual([3, 6]);
    expect(renameSelection("報告.txt", false, "all")).toEqual([0, 6]);
  });

  it("takes what follows the last dot as the extension", () => {
    expect(renameSelection("a.tar.gz", false, "base")).toEqual([0, 5]);
    expect(renameSelection("a.tar.gz", false, "ext")).toEqual([6, 8]);
    expect(renameSelection("a.", false, "ext")).toEqual([2, 2]);
  });

  it("selects everything where there is no extension to tell apart", () => {
    for (const part of ["base", "ext"] as const) {
      expect(renameSelection("readme", false, part)).toEqual([0, 6]);
      expect(renameSelection(".gitignore", false, part)).toEqual([0, 10]);
      expect(renameSelection("v1.2", true, part)).toEqual([0, 4]);
    }
  });

  it("goes to the extension, then back and forth", () => {
    expect(nextRenamePart("base")).toBe("ext");
    expect(nextRenamePart("all")).toBe("ext");
    expect(nextRenamePart("ext")).toBe("base");
  });
});

describe("renameTo", () => {
  it("is the trimmed name, or nothing when it is empty or unchanged", () => {
    expect(renameTo("C:\\work\\a.txt", " b.txt ")).toBe("b.txt");
    expect(renameTo("C:\\work\\a.txt", "a.txt")).toBeNull();
    expect(renameTo("C:\\work\\a.txt", "  ")).toBeNull();
    expect(renameTo("C:\\work\\a.txt", "A.txt")).toBe("A.txt");
  });
});

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
