import { describe, expect, it } from "vitest";
import { externalAction } from "../model/navigation";
import { modsOf } from "../model/input";
import { accessKeyPressed, switchesOnHover } from "./popup";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("accessKeyPressed", () => {
  it("takes a plain letter", () => {
    expect(accessKeyPressed(key("d"))).toBe("d");
  });

  it("still takes the letter while Ctrl / Shift / Alt is held", () => {
    expect(accessKeyPressed(key("d", { ctrlKey: true }))).toBe("d");
    expect(accessKeyPressed(key("D", { shiftKey: true }))).toBe("d");
    expect(accessKeyPressed(key("D", { shiftKey: true, altKey: true }))).toBe("d");
  });

  it("ignores modifier and named keys, and the Windows key", () => {
    expect(accessKeyPressed(key("Control", { ctrlKey: true }))).toBeNull();
    expect(accessKeyPressed(key("F2"))).toBeNull();
    expect(accessKeyPressed(key("d", { metaKey: true }))).toBeNull();
  });

  it("Ctrl + access key in a link menu appends a pane and keeps the current view", () => {
    expect(externalAction(modsOf(key("d", { ctrlKey: true })))).toBe("append");
    expect(externalAction(modsOf(key("d")))).toBe("open");
  });
});

describe("switchesOnHover", () => {
  it("switches to another link button's menu while a link menu is open", () => {
    expect(switchesOnHover("link:1", "link:2", "link:", true)).toBe(true);
  });

  it("keeps the menu on the same button, on a button without a menu, or when no link menu is open", () => {
    expect(switchesOnHover("link:1", "link:1", "link:", true)).toBe(false);
    expect(switchesOnHover("link:1", "link:2", "link:", false)).toBe(false);
    expect(switchesOnHover(null, "link:2", "link:", true)).toBe(false);
    expect(switchesOnHover("", "link:2", "link:", true)).toBe(false);
  });
});
