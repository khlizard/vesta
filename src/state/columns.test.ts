import { describe, expect, it } from "vitest";
import { listFont } from "./columns";

describe("listFont", () => {
  it("measures with the current text size", () => {
    expect(listFont(16)).toBe('16px "Yu Gothic UI", "Meiryo UI", sans-serif');
    expect(listFont(12)).toMatch(/^12px "Yu Gothic UI"/);
  });
});
