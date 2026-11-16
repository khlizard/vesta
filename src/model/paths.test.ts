import { describe, expect, it } from "vitest";
import { parentPath, sameVolume, splitByParent, uniqueByLocation, volumeRoot } from "./paths";

describe("paths", () => {
  it("finds the parent ignoring case and trailing separators", () => {
    expect(parentPath("C:\\A\\b.txt")).toBe("c:\\a");
    expect(parentPath("C:\\A\\sub\\")).toBe("c:\\a");
  });

  it("splits items already in the destination from the rest", () => {
    expect(splitByParent(["C:\\a\\x.txt", "C:\\b\\y.txt", "c:\\A\\z"], "C:\\a\\")).toEqual({
      same: ["C:\\a\\x.txt", "c:\\A\\z"],
      other: ["C:\\b\\y.txt"],
    });
    expect(splitByParent(["C:\\a\\sub"], "C:\\a\\sub")).toEqual({ same: [], other: ["C:\\a\\sub"] });
  });
});

describe("uniqueByLocation", () => {
  it("drops later repeats of a location and keeps the order", () => {
    const a = { location: "C:\\a", n: 1 };
    const b = { location: "C:\\b", n: 2 };
    const a2 = { location: "C:\\a", n: 3 };
    expect(uniqueByLocation([a, b, a2])).toEqual([a, b]);
  });

  it("returns the same array when nothing repeats", () => {
    const items = [{ location: "C:\\a" }, { location: "C:\\b" }];
    expect(uniqueByLocation(items)).toBe(items);
  });
});

describe("sameVolume", () => {
  it("compares drive letters", () => {
    expect(sameVolume("C:\\a\\b.txt", "c:\\x")).toBe(true);
    expect(sameVolume("C:\\a", "D:\\a")).toBe(false);
  });

  it("compares server and share for network paths", () => {
    expect(sameVolume("\\\\srvA\\share\\a.txt", "\\\\SRVA\\Share\\sub")).toBe(true);
    expect(sameVolume("\\\\srvA\\share\\a.txt", "\\\\srvB\\share\\sub")).toBe(false);
    expect(sameVolume("\\\\srvA\\one\\a.txt", "\\\\srvA\\two")).toBe(false);
    expect(sameVolume("\\\\srvA\\share\\a.txt", "C:\\x")).toBe(false);
  });

  it("is false for virtual locations", () => {
    expect(sameVolume("::{645FF040}", "::{645FF040}")).toBe(false);
    expect(volumeRoot("DESKTOP")).toBe("");
  });
});
