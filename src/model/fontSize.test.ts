import { describe, expect, it } from "vitest";
import { normalizeFontSize, scaleWidths, textMetrics } from "./fontSize";

describe("normalizeFontSize", () => {
  it("keeps the offered sizes and falls back to 12", () => {
    expect(normalizeFontSize(16)).toBe(16);
    expect(normalizeFontSize(11)).toBe(11);
    expect(normalizeFontSize(13)).toBe(12);
    expect(normalizeFontSize("14")).toBe(12);
    expect(normalizeFontSize(undefined)).toBe(12);
  });
});

describe("textMetrics", () => {
  it("matches the original fixed heights at 12px", () => {
    expect(textMetrics(12)).toEqual({ line: 20, labelLine: 15, row: 20, thumbLabel: 32, group: 22 });
  });

  it("grows with the text", () => {
    expect(textMetrics(16)).toEqual({ line: 24, labelLine: 19, row: 24, thumbLabel: 40, group: 26 });
  });
});

describe("scaleWidths", () => {
  it("scales text columns with the text and keeps the status column", () => {
    expect(scaleWidths({ name: 220, status: 48, modified: 130 }, 12, 16)).toEqual({
      name: 293,
      status: 48,
      modified: 173,
    });
    expect(scaleWidths({ name: 293, status: 48 }, 16, 12)).toEqual({ name: 220, status: 48 });
  });

  it("changes nothing when the size stays", () => {
    expect(scaleWidths({ name: 220 }, 12, 12)).toEqual({ name: 220 });
  });
});
