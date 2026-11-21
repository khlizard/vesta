import { describe, expect, it } from "vitest";
import { labelParts, menuLabel } from "./menu";
import { expandArgs, linkAction, normalizeExecute, quote } from "./execute";

describe("expandArgs", () => {
  const sel = ["C:\\a b.txt", "C:\\c.txt"];

  it("expands {selected} and {current} into one command", () => {
    expect(expandArgs("/x {selected} {current}", sel, "C:\\")).toEqual(['/x "C:\\a b.txt" "C:\\c.txt" "C:\\\\"']);
  });

  it("starts one process per item for [selected]", () => {
    expect(expandArgs("[selected]", sel, null)).toEqual(['"C:\\a b.txt"', '"C:\\c.txt"']);
  });

  it("handles no selection", () => {
    expect(expandArgs("[selected]", [], null)).toEqual([""]);
    expect(expandArgs("", [], null)).toEqual([""]);
  });
});

describe("menuLabel", () => {
  it("extracts the access key", () => {
    expect(menuLabel("ファイル(_F)")).toEqual({ label: "ファイル(F)", accessKey: "f" });
    expect(menuLabel("ごみ箱を空にする(_E)...{*}")).toEqual({ label: "ごみ箱を空にする(E)...", accessKey: "e" });
    expect(menuLabel("fav")).toEqual({ label: "fav", accessKey: null });
    expect(menuLabel("a_")).toEqual({ label: "a_", accessKey: null });
    expect(labelParts("ファイル(_F)")).toEqual({ before: "ファイル(", key: "F", after: ")" });
  });
});

describe("normalizeExecute", () => {
  it("converts separators", () => {
    expect(normalizeExecute("SYSTEM/cmd.exe")).toBe("SYSTEM\\cmd.exe");
    expect(normalizeExecute("C:¥Program Files¥Editor¥editor.exe")).toBe("C:\\Program Files\\Editor\\editor.exe");
  });
});

describe("linkAction", () => {
  it("executes a file with its args", () => {
    expect(linkAction("C:\\a\\app.exe", false, "--x {current}")).toEqual({
      execute: "C:\\a\\app.exe",
      args: "--x {current}",
    });
  });

  it("opens files without args and folders as before", () => {
    expect(linkAction("C:\\a\\book.xlsx", false, undefined)).toEqual({ path: "C:\\a\\book.xlsx" });
    expect(linkAction("C:\\a\\app.exe", false, "")).toEqual({ path: "C:\\a\\app.exe" });
    expect(linkAction("C:\\a", true, "--x")).toEqual({ path: "C:\\a" });
  });
});

describe("web addresses in execute", () => {
  it("are kept as written", () => {
    expect(normalizeExecute("https://github.com/khlizard/vesta")).toBe("https://github.com/khlizard/vesta");
    expect(normalizeExecute("SYSTEM/cmd.exe")).toBe("SYSTEM\\cmd.exe");
  });
});

describe("quote", () => {
  it("doubles trailing backslashes so the closing quote survives", () => {
    expect(quote("C:\\")).toBe('"C:\\\\"');
    expect(quote("C:\\a b\\c")).toBe('"C:\\a b\\c"');
    expect(expandArgs("-d {current} -x", [], "D:\\")).toEqual(['-d "D:\\\\" -x']);
  });
});

describe("expandArgs with special characters", () => {
  it("keeps $ sequences in file names as they are", () => {
    expect(expandArgs("{selected}", ["C:\\a$&b.txt"], null)).toEqual(['"C:\\a$&b.txt"']);
    expect(expandArgs("[selected] {current}", ["C:\\$1.txt"], "C:\\$$")).toEqual(['"C:\\$1.txt" "C:\\$$"']);
  });
});
