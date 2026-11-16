import { describe, expect, it } from "vitest";
import { stepThumbnailSize } from "./thumbSize";

describe("stepThumbnailSize", () => {
  it("steps by 32 within 96..512", () => {
    expect(stepThumbnailSize(96, 1)).toBe(128);
    expect(stepThumbnailSize(128, -1)).toBe(96);
    expect(stepThumbnailSize(96, -1)).toBe(96);
    expect(stepThumbnailSize(512, 1)).toBe(512);
    expect(stepThumbnailSize(480, 1)).toBe(512);
  });

  it("brings sizes outside the range or off the steps back in", () => {
    expect(stepThumbnailSize(64, 1)).toBe(96);
    expect(stepThumbnailSize(64, -1)).toBe(96);
    expect(stepThumbnailSize(100, 1)).toBe(128);
    expect(stepThumbnailSize(100, -1)).toBe(96);
    expect(stepThumbnailSize(1000, -1)).toBe(512);
  });
});
