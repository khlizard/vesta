import { describe, expect, it } from "vitest";
import { formatBuildTime } from "./buildTime";

describe("formatBuildTime", () => {
  it("formats in local time with zero padding", () => {
    const d = new Date(2026, 0, 5, 9, 3);
    expect(formatBuildTime(d.toISOString())).toBe("2026-01-05 09:03");
  });

  it("is empty for something that is not a date", () => {
    expect(formatBuildTime("")).toBe("");
    expect(formatBuildTime("x")).toBe("");
  });

  it("has a build time defined at build", () => {
    expect(formatBuildTime(__BUILD_TIME__)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
