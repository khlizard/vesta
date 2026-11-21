import { describe, expect, it } from "vitest";
import type { Entry } from "../api/types";
import { formatAttributes, formatBytes, formatDate, formatSizeColumn, statusText } from "./format";
import { computeLabels } from "./labels";
import { externalAction, inPaneAction } from "./navigation";
import { groupEntries, groupOf, sortEntries } from "./sort";

const m = (s: string) => ({ ctrl: s.includes("C"), shift: s.includes("S"), alt: s.includes("A") });

describe("navigation actions", () => {
  it("follows the in-pane table", () => {
    expect(inPaneAction(m(""), false)).toBe("goto");
    expect(inPaneAction(m(""), true)).toBe("append");
    expect(inPaneAction(m("C"), false)).toBe("append");
    expect(inPaneAction(m("C"), true)).toBe("goto");
    expect(inPaneAction(m("S"), false)).toBe("reserve");
    expect(inPaneAction(m("S"), true)).toBe("reserve");
    expect(inPaneAction(m("CS"), false)).toBe("replace");
    expect(inPaneAction(m("CS"), true)).toBe("append");
    expect(inPaneAction(m("SA"), true)).toBe("switch");
    expect(inPaneAction(m("CA"), true)).toBe("gotoAlways");
  });

  it("follows the external table", () => {
    expect(externalAction(m(""))).toBe("open");
    expect(externalAction(m("C"))).toBe("append");
    expect(externalAction(m("S"))).toBe("reserve");
    expect(externalAction(m("CS"))).toBe("replace");
    expect(externalAction(m("SA"))).toBe("switch");
  });
});

describe("labels", () => {
  const src = (id: string, path: string | null, name = id) => ({
    id,
    location: path ?? `::{${id}}`,
    displayName: name,
    fsPath: path,
  });

  it("uses the last part when unique", () => {
    const l = computeLabels([src("1", "D:\\Photos\\2024"), src("2", "D:\\Work\\notes")], true);
    expect(l.get("1")).toBe("2024");
    expect(l.get("2")).toBe("notes");
  });

  it("adds parents until labels differ (case-insensitive)", () => {
    const l = computeLabels(
      [src("1", "D:\\Photos\\2024"), src("2", "D:\\Backup\\Old\\2024"), src("3", "D:\\x\\Photos\\2024")],
      true,
    );
    expect(l.get("1")).toBe("D:\\Photos\\2024");
    expect(l.get("2")).toBe("Old\\2024");
    expect(l.get("3")).toBe("x\\Photos\\2024");
  });

  it("does not grow for duplicate tabs of the same folder", () => {
    const l = computeLabels([src("1", "D:\\a\\2024"), src("2", "D:\\a\\2024")], true);
    expect(l.get("1")).toBe("2024");
  });

  it("uses only the last part when not distinguishing", () => {
    const l = computeLabels([src("1", "D:\\Photos\\2024"), src("2", "D:\\Backup\\2024")], false);
    expect(l.get("2")).toBe("2024");
  });

  it("uses the display name for virtual folders and drive roots keep the drive", () => {
    const l = computeLabels([src("1", null, "PC"), src("2", "D:\\")], true);
    expect(l.get("1")).toBe("PC");
    expect(l.get("2")).toBe("D:");
  });
});

describe("format", () => {
  it("formats byte sizes like StrFormatByteSize", () => {
    expect(formatBytes(0)).toBe("0 バイト");
    expect(formatBytes(1023)).toBe("1023 バイト");
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(1536)).toBe("1.50 KB");
    expect(formatBytes(12.34 * 1024)).toBe("12.3 KB");
    expect(formatBytes(999 * 1024)).toBe("999 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
  });

  it("formats the size column", () => {
    expect(formatSizeColumn(null)).toBe("");
    expect(formatSizeColumn(0)).toBe("0 KB");
    expect(formatSizeColumn(1)).toBe("1 KB");
    expect(formatSizeColumn(1234 * 1024)).toBe("1,234 KB");
  });

  it("formats dates", () => {
    expect(formatDate(new Date(2026, 10, 8, 9, 5).getTime())).toBe("2026/11/08 09:05");
  });

  it("builds the status text", () => {
    expect(statusText({ total: 23, totalBytes: 0, selected: 1, selectedBytes: 0, disk: null })).toBe(
      "1 / 23 個のオブジェクトを選択 ( 0 バイト )",
    );
    expect(
      statusText({ total: 5, totalBytes: 2048, selected: 0, selectedBytes: 0, disk: { label: "D", free: 1024 ** 3 } }),
    ).toBe("5 個のオブジェクト ( 2.00 KB ) / 空きディスク領域 [D] 1.00 GB");
    expect(statusText({ total: 3, totalBytes: 0, selected: 0, selectedBytes: 0, disk: null })).toBe("3 個のオブジェクト");
  });
});

function entry(name: string, over: Partial<Entry> = {}): Entry {
  return {
    name,
    location: `C:\\t\\${name}`,
    isFolder: false,
    isLink: false,
    size: 0,
    modified: 0,
    created: null,
    accessed: null,
    attributes: 0x20,
    typeName: "",
    hidden: false,
    system: false,
    syncState: null,
    ...over,
  };
}

describe("sort", () => {
  it("puts folders first and compares names naturally", () => {
    const sorted = sortEntries(
      [entry("file10"), entry("file2"), entry("zdir", { isFolder: true, size: null }), entry("File1")],
      "name",
      false,
    );
    expect(sorted.map((e) => e.name)).toEqual(["zdir", "File1", "file2", "file10"]);
  });

  it("orders numbers in Japanese names by value, full-width digits too", () => {
    const sorted = (names: string[]) => sortEntries(names.map((n) => entry(n)), "name", false).map((e) => e.name);
    expect(sorted(["第10章", "第2章", "第1章"])).toEqual(["第1章", "第2章", "第10章"]);
    expect(sorted(["第１０章", "第２章", "第１章"])).toEqual(["第１章", "第２章", "第１０章"]);
    // Symbols and digits first, then Latin, kana, kanji; emoji do not break the order.
    expect(sorted(["漢字", "かな", "abc", "123", "😀"])).toEqual(["😀", "123", "abc", "かな", "漢字"]);
  });

  it("sorts by size descending with ties by name", () => {
    const sorted = sortEntries([entry("a", { size: 5 }), entry("b", { size: 9 }), entry("c", { size: 5 })], "size", true);
    expect(sorted.map((e) => e.name)).toEqual(["b", "c", "a"]);
  });
});

describe("groups", () => {
  // Wednesday 2026-11-11 12:00 local time.
  const now = new Date(2026, 10, 11, 12, 0).getTime();
  const at = (y: number, mo: number, d: number) => new Date(y, mo, d, 10, 0).getTime();

  it("groups dates like Explorer", () => {
    const g = (ms: number) => groupOf(entry("x", { modified: ms }), "modified", now).label;
    expect(g(at(2026, 10, 11))).toBe("今日");
    expect(g(at(2026, 10, 10))).toBe("昨日");
    expect(g(at(2026, 10, 8))).toBe("今週の前半");
    expect(g(at(2026, 10, 3))).toBe("先週");
    expect(g(at(2026, 10, 1))).toBe("先週"); // the week of Nov 1-7 is last week
    const late = new Date(2026, 10, 25, 12, 0).getTime();
    expect(groupOf(entry("x", { modified: at(2026, 10, 3) }), "modified", late).label).toBe("今月の前半");
    expect(g(at(2026, 9, 20))).toBe("先月");
    expect(g(at(2026, 2, 1))).toBe("今年の前半");
    expect(g(at(2025, 5, 1))).toBe("昨年");
    expect(g(at(2020, 0, 1))).toBe("かなり前");
  });

  it("groups names by first character", () => {
    const g = (n: string) => groupOf(entry(n), "name", now).label;
    expect(g("apple")).toBe("A");
    expect(g("2026-11")).toBe("0 - 9");
    expect(g("カメラ")).toBe("か行");
    expect(g("ゆき")).toBe("や行");
    expect(g("漢字")).toBe("その他");
  });

  it("orders date groups newest first when descending", () => {
    const rows = groupEntries(
      sortEntries([entry("old", { modified: at(2020, 0, 1) }), entry("new", { modified: at(2026, 10, 11) })], "modified", true),
      "modified",
      true,
      now,
    );
    expect(rows.map((r) => r.group.label)).toEqual(["今日", "かなり前"]);
  });
});

describe("new columns", () => {
  const now = new Date(2026, 10, 11, 12, 0).getTime();

  it("formats attributes like Explorer", () => {
    expect(formatAttributes(null)).toBe("");
    expect(formatAttributes(0)).toBe("");
    expect(formatAttributes(0x20)).toBe("A");
    expect(formatAttributes(0x1 | 0x2 | 0x4 | 0x20)).toBe("RHSA");
    expect(formatAttributes(0x10 | 0x800 | 0x4000)).toBe("DCE");
  });

  it("sorts and groups by created / accessed / attributes", () => {
    const a = entry("a", { created: 2, accessed: 1, attributes: 0x21 });
    const b = entry("b", { created: 1, accessed: 2, attributes: 0x20 });
    expect(sortEntries([a, b], "created", false).map((e) => e.name)).toEqual(["b", "a"]);
    expect(sortEntries([a, b], "accessed", false).map((e) => e.name)).toEqual(["a", "b"]);
    expect(sortEntries([a, b], "attributes", false).map((e) => e.name)).toEqual(["b", "a"]);
    expect(groupOf(entry("x", { created: now }), "created", now).label).toBe("今日");
    expect(groupOf(entry("x", { accessed: null }), "accessed", now).label).toBe("不明");
    expect(groupOf(a, "attributes", now).label).toBe("RA");
    expect(groupOf(entry("x", { attributes: null }), "attributes", now).label).toBe("なし");
  });
});
