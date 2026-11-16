import { describe, expect, it } from "vitest";
import { COMMAND_ICONS, toolContent } from "./icons";

const bars = import.meta.glob<string>("../../src-tauri/resources/usr/{menu,tool,status}.xml", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("command icons", () => {
  it("has an icon for every image number in the default menu / tool / status bars", () => {
    let count = 0;
    for (const [file, xml] of Object.entries(bars)) {
      for (const m of xml.matchAll(/image="(\d+)"/g)) {
        expect(COMMAND_ICONS[Number(m[1])], `${file} image ${m[1]}`).toBeDefined();
        count++;
      }
    }
    expect(Object.keys(bars)).toHaveLength(3);
    expect(count).toBeGreaterThan(0);
  });

  it("has an icon for Avesta's view-mode drop-down (26)", () => {
    expect(COMMAND_ICONS[26]).toBeDefined();
  });
});

describe("toolContent", () => {
  it("prefers the icon, then the text, then a generic icon", () => {
    expect(toolContent(26, "")).toBe("icon");
    expect(toolContent(26, "表示")).toBe("icon");
    expect(toolContent(99, "表示")).toBe("text");
    expect(toolContent(undefined, "表示")).toBe("text");
    expect(toolContent(99, "")).toBe("fallback");
    expect(toolContent(undefined, undefined)).toBe("fallback");
  });
});
