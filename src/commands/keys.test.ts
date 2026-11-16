import { describe, expect, it } from "vitest";
import type { KeyBinding } from "../config/types";
import { isBrowserShortcut, keyName, matchBinding, modifierString } from "./keys";

const ev = (code: string, key = "") => ({ code, key });
const mods = (s: string) => ({
  ctrlKey: s.includes("C"),
  shiftKey: s.includes("S"),
  altKey: s.includes("A"),
  metaKey: s.includes("W"),
});

describe("keyName", () => {
  it("uses code for letters and digits regardless of key", () => {
    expect(keyName(ev("KeyA", "a"))).toBe("A");
    expect(keyName(ev("KeyZ", "Process"))).toBe("Z");
    expect(keyName(ev("Digit1", "!"))).toBe("1");
    expect(keyName(ev("Numpad7", "7"))).toBe("7");
  });
  it("names function and special keys", () => {
    expect(keyName(ev("F2"))).toBe("F2");
    expect(keyName(ev("F24"))).toBe("F24");
    expect(keyName(ev("F25"))).toBe("");
    expect(keyName(ev("Backspace"))).toBe("backspace");
    expect(keyName(ev("Enter"))).toBe("return");
    expect(keyName(ev("PageDown"))).toBe("pagedown");
    expect(keyName(ev("ArrowLeft"))).toBe("←");
    expect(keyName(ev("ArrowDown"))).toBe("↓");
    expect(keyName(ev("Space", " "))).toBe("space");
  });
  it("names punctuation by position", () => {
    expect(keyName(ev("Comma", "<"))).toBe(",");
    expect(keyName(ev("Period", ">"))).toBe(".");
    expect(keyName(ev("Slash", "?"))).toBe("/");
    expect(keyName(ev("Semicolon", "+"))).toBe(";");
    expect(keyName(ev("Minus", "="))).toBe("-");
  });
  it("returns empty for modifier keys", () => {
    expect(keyName(ev("ControlLeft", "Control"))).toBe("");
    expect(keyName(ev("ShiftRight", "Shift"))).toBe("");
    expect(keyName(ev("AltLeft", "Alt"))).toBe("");
  });
});

describe("modifierString", () => {
  it("lists pressed modifiers in CSAW order", () => {
    expect(modifierString(mods(""))).toBe("");
    expect(modifierString(mods("C"))).toBe("C");
    expect(modifierString(mods("ACS"))).toBe("CSA");
    expect(modifierString(mods("W"))).toBe("W");
  });
});

describe("matchBinding", () => {
  const b = (modifier: string, key: string): KeyBinding => ({ modifier, key, item: { command: `${modifier}+${key}` } });
  const list = [b("C", "A"), b("CS", "C"), b("A", "←"), b("", "backspace"), b("S", ",")];

  it("matches regardless of case and modifier order", () => {
    expect(matchBinding(list, "C", "a")?.item.command).toBe("C+A");
    expect(matchBinding(list, "SC", "C")?.item.command).toBe("CS+C");
    expect(matchBinding(list, "", "BackSpace")?.item.command).toBe("+backspace");
  });
  it("requires the exact modifier set", () => {
    expect(matchBinding(list, "CS", "A")).toBeUndefined();
    expect(matchBinding(list, "", "A")).toBeUndefined();
  });
  it("treats arrow names as equivalent", () => {
    expect(matchBinding(list, "A", "left")?.item.command).toBe("A+←");
    expect(matchBinding([b("A", "left")], "A", "←")).toBeDefined();
    expect(matchBinding([b("", "Up")], "", "↑")).toBeDefined();
  });
  it("matches punctuation and ignores empty keys", () => {
    expect(matchBinding(list, "S", ",")).toBeDefined();
    expect(matchBinding(list, "C", "")).toBeUndefined();
  });
});

describe("keyboard layout", () => {
  const jis = new Map([
    ["BracketLeft", "@"],
    ["BracketRight", "["],
    ["Quote", ":"],
    ["Equal", "^"],
    ["IntlYen", "¥"],
    ["KeyA", "a"],
    ["Digit1", "1"],
  ]);
  const ev = (code: string, key = "") => ({ code, key }) as KeyboardEvent;

  it("names symbol keys by what the layout types", () => {
    expect(keyName(ev("BracketLeft", "@"), jis)).toBe("@");
    expect(keyName(ev("BracketRight", "["), jis)).toBe("[");
    expect(keyName(ev("Quote", ":"), jis)).toBe(":");
    expect(keyName(ev("IntlYen", "¥"), jis)).toBe("\\");
  });

  it("keeps letters, digits and named keys", () => {
    expect(keyName(ev("KeyA", "a"), jis)).toBe("A");
    expect(keyName(ev("Digit1", "!"), jis)).toBe("1");
    expect(keyName(ev("Comma", "<"), jis)).toBe(",");
    expect(keyName(ev("Enter", "Enter"), jis)).toBe("return");
  });

  it("uses US positions without a layout", () => {
    expect(keyName(ev("BracketLeft", "["), null)).toBe("[");
  });
});

describe("isBrowserShortcut", () => {
  it("covers reload, print, find and history keys", () => {
    expect(isBrowserShortcut("", "F5")).toBe(true);
    expect(isBrowserShortcut("C", "R")).toBe(true);
    expect(isBrowserShortcut("SC", "r")).toBe(true);
    expect(isBrowserShortcut("C", "P")).toBe(true);
    expect(isBrowserShortcut("A", "←")).toBe(true);
  });

  it("leaves editing keys alone", () => {
    for (const k of ["A", "C", "V", "X", "Z", "Y"]) expect(isBrowserShortcut("C", k)).toBe(false);
    expect(isBrowserShortcut("", "delete")).toBe(false);
    expect(isBrowserShortcut("", "F2")).toBe(false);
  });
});
