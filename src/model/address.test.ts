import { describe, expect, it } from "vitest";
import { committedText, listableParent, matchingNames, splitTyped } from "./address";

describe("splitTyped", () => {
  it("splits at the last separator, of either kind", () => {
    expect(splitTyped("C:\\Users\\pu")).toEqual({ parent: "C:\\Users\\", prefix: "pu" });
    expect(splitTyped("C:/Users/pu")).toEqual({ parent: "C:/Users/", prefix: "pu" });
    expect(splitTyped("~/Do")).toEqual({ parent: "~/", prefix: "Do" });
    expect(splitTyped("C:\\")).toEqual({ parent: "C:\\", prefix: "" });
  });

  it("is null while no separator has been typed", () => {
    expect(splitTyped("C:")).toBeNull();
    expect(splitTyped("")).toBeNull();
  });
});

describe("matchingNames", () => {
  const names = ["Alpha", "alto", "Beta", "al dente"];

  it("keeps the names starting with the prefix, ignoring case, in order", () => {
    expect(matchingNames(names, "AL", 20)).toEqual(["Alpha", "alto", "al dente"]);
    expect(matchingNames(names, "", 20)).toEqual(names);
    expect(matchingNames(names, "z", 20)).toEqual([]);
  });

  it("stops at the limit", () => {
    expect(matchingNames(names, "a", 2)).toEqual(["Alpha", "alto"]);
  });
});

describe("listableParent", () => {
  it("uses backslashes and marks a path under ~ for resolving", () => {
    expect(listableParent("C:/Users/")).toEqual({ path: "C:\\Users\\", resolve: false });
    expect(listableParent("~/Downloads/")).toEqual({ path: "~\\Downloads\\", resolve: true });
    expect(listableParent("~\\")).toEqual({ path: "~\\", resolve: true });
    expect(listableParent("C:\\~\\")).toEqual({ path: "C:\\~\\", resolve: false });
  });
});

describe("committedText", () => {
  const suggest = { parent: "C:\\Users\\", names: ["Public", "pu2"] };

  it("is the picked suggestion with its folder", () => {
    expect(committedText(suggest, 1, "C:\\Users\\pu")).toBe("C:\\Users\\pu2");
  });

  it("is what was typed when nothing is picked or there is no list", () => {
    expect(committedText(suggest, -1, "C:\\Users\\pu")).toBe("C:\\Users\\pu");
    expect(committedText(suggest, 5, "x")).toBe("x");
    expect(committedText(null, 0, "D:\\")).toBe("D:\\");
  });
});
