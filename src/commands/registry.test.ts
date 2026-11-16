import { describe, expect, it } from "vitest";
import { ancestorKeys } from "../state/folderViews";
import { patternToRegExp } from "../state/selection";
import { parseCommand } from "./registry";

describe("parseCommand", () => {
  it("parses names, indexes and arguments", () => {
    expect(parseCommand("Current.Go.Up")).toEqual({ name: "Current.Go.Up", index: null, arg: null });
    expect(parseCommand("Tab[3].Show(toggle)")).toEqual({ name: "Tab[].Show", index: 3, arg: "toggle" });
    expect(parseCommand(" All.Show(true) ")).toEqual({ name: "All.Show", index: null, arg: "true" });
    expect(parseCommand("Option.Thumbnail.96")).toEqual({ name: "Option.Thumbnail.96", index: null, arg: null });
  });
});

describe("patternToRegExp", () => {
  it("matches wildcards case-insensitively, several patterns with ;", () => {
    const re = patternToRegExp("*.txt; a?c.md");
    expect(re.test("README.TXT")).toBe(true);
    expect(re.test("abc.md")).toBe(true);
    expect(re.test("abbc.md")).toBe(false);
    expect(re.test("x.txt.bak")).toBe(false);
  });

  it("matches nothing for an empty pattern", () => {
    expect(patternToRegExp("").test("a")).toBe(false);
  });
});

describe("ancestorKeys", () => {
  it("walks up file-system paths", () => {
    expect(ancestorKeys("D:\\Work\\_VR\\dev\\")).toEqual(["d:\\work\\_vr\\dev", "d:\\work\\_vr", "d:\\work", "d:"]);
  });

  it("stops at the server for UNC paths", () => {
    expect(ancestorKeys("\\\\srv\\share\\a")).toEqual(["\\\\srv\\share\\a", "\\\\srv\\share"]);
  });

  it("keeps virtual locations as a single key", () => {
    expect(ancestorKeys("::{20D04FE0-3AEA-1069-A2D8-08002B30309D}")).toEqual([
      "::{20d04fe0-3aea-1069-a2d8-08002b30309d}",
    ]);
  });
});
