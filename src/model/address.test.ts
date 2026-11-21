import { describe, expect, it } from "vitest";
import { listableParent, matchingNames, splitTyped } from "./address";

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
