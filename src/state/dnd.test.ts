import { describe, expect, it, vi } from "vitest";
import {
  createHoverTimer,
  isNoopDrop,
  isSelfDrop,
  isUsefulDrop,
  resolveTarget,
  rightDropItems,
  toCssPoint,
  type DropAttrs,
} from "./dnd";

const tabLoc = (id: string) => ({ t1: "C:\\a", t2: "D:\\b" })[id as "t1" | "t2"] ?? null;
const paneLoc = (id: string) => ({ t1: "C:\\a", t2: null })[id as "t1" | "t2"] ?? null;

describe("resolveTarget", () => {
  it("prefers the nearest folder item", () => {
    const chain: DropAttrs[] = [{}, { folder: "C:\\a\\sub" }, { pane: "t1" }];
    expect(resolveTarget(chain, tabLoc, paneLoc)).toEqual({ kind: "folder", location: "C:\\a\\sub", index: 1 });
  });

  it("uses a tab's folder when no folder item is hit", () => {
    expect(resolveTarget([{ tab: "t2" }], tabLoc, paneLoc)).toEqual({
      kind: "tab",
      tabId: "t2",
      location: "D:\\b",
      index: 0,
    });
  });

  it("falls back to the pane's folder", () => {
    const chain: DropAttrs[] = [{}, {}, { pane: "t1" }];
    expect(resolveTarget(chain, tabLoc, paneLoc)).toEqual({ kind: "pane", tabId: "t1", location: "C:\\a", index: 2 });
  });

  it("returns null for unknown or empty targets", () => {
    expect(resolveTarget([], tabLoc, paneLoc)).toBeNull();
    expect(resolveTarget([{ pane: "t2" }], tabLoc, paneLoc)).toBeNull();
    expect(resolveTarget([{ tab: "zz" }], tabLoc, paneLoc)).toBeNull();
    expect(resolveTarget([{ folder: null, tab: null, pane: null }], tabLoc, paneLoc)).toBeNull();
  });
});

describe("toCssPoint", () => {
  it("divides by the device pixel ratio", () => {
    expect(toCssPoint({ x: 300, y: 150 }, 1.5)).toEqual({ x: 200, y: 100 });
  });
  it("treats an invalid ratio as 1", () => {
    expect(toCssPoint({ x: 10, y: 20 }, 0)).toEqual({ x: 10, y: 20 });
  });
});

describe("isSelfDrop", () => {
  it("detects dropping an item onto itself, ignoring case and trailing slashes", () => {
    expect(isSelfDrop(["C:\\A\\Sub"], "c:\\a\\sub\\")).toBe(true);
    expect(isSelfDrop(["C:\\a\\x", "C:\\a\\sub"], "C:\\a\\sub")).toBe(true);
  });
  it("allows other destinations", () => {
    expect(isSelfDrop(["C:\\a\\sub"], "C:\\a")).toBe(false);
    expect(isSelfDrop(["C:\\a\\sub"], "C:\\a\\sub2")).toBe(false);
  });
});

describe("createHoverTimer", () => {
  it("fires once after the delay on the same tab", () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const h = createHoverTimer(500, fire);
    h.set("t1");
    vi.advanceTimersByTime(300);
    h.set("t1");
    vi.advanceTimersByTime(250);
    expect(fire).toHaveBeenCalledExactlyOnceWith("t1");
    h.set("t1");
    vi.advanceTimersByTime(1000);
    expect(fire).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("restarts when the hovered tab changes and cancels on leave", () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const h = createHoverTimer(500, fire);
    h.set("t1");
    vi.advanceTimersByTime(400);
    h.set("t2");
    vi.advanceTimersByTime(400);
    expect(fire).not.toHaveBeenCalled();
    h.set(null);
    vi.advanceTimersByTime(1000);
    expect(fire).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("isNoopDrop", () => {
  it("is true onto the items themselves or into the folder they are in", () => {
    expect(isNoopDrop(["C:\\a\\sub"], "C:\\a\\sub")).toBe(true);
    expect(isNoopDrop(["C:\\a\\x", "C:\\A\\y"], "c:\\a\\")).toBe(true);
  });
  it("is false for another folder, items from several folders, or an unknown drag", () => {
    expect(isNoopDrop(["C:\\a\\x"], "C:\\b")).toBe(false);
    expect(isNoopDrop(["C:\\a\\x"], "C:\\a\\sub")).toBe(false);
    expect(isNoopDrop(["C:\\a\\x", "C:\\b\\y"], "C:\\a")).toBe(false);
    expect(isNoopDrop([], "C:\\a")).toBe(false);
  });
});

describe("program and shortcut items", () => {
  it("are targets like folder items, the nearest winning", () => {
    const chain: DropAttrs[] = [{ file: "C:\\a\\run.bat" }, { pane: "t1" }];
    expect(resolveTarget(chain, tabLoc, paneLoc)).toEqual({ kind: "file", location: "C:\\a\\run.bat", index: 0 });
  });

  it("are passed over by a drag without paths, which goes to the pane", () => {
    const chain: DropAttrs[] = [{ file: "C:\\a\\run.bat" }, { pane: "t1" }];
    expect(resolveTarget(chain, tabLoc, paneLoc, false)).toEqual({
      kind: "pane",
      tabId: "t1",
      location: "C:\\a",
      index: 1,
    });
  });

  it("are worth a drop from their own folder, but not of themselves", () => {
    const bat = { kind: "file" as const, location: "C:\\a\\run.bat", index: 0 };
    expect(isUsefulDrop(["C:\\a\\data.csv"], bat)).toBe(true);
    expect(isUsefulDrop(["C:\\a\\run.bat"], bat)).toBe(false);
    // A folder the files are already in is not.
    expect(isUsefulDrop(["C:\\a\\data.csv"], { kind: "pane", tabId: "t1", location: "C:\\a", index: 0 })).toBe(false);
  });
});

describe("rightDropItems", () => {
  const choose = (paths: string[], dest: string, text: string) => {
    const drop = vi.fn();
    const item = rightDropItems(paths, dest, drop).find((i) => i.text?.startsWith(text));
    item?.onSelect?.({ ctrl: false, shift: false, alt: false });
    return drop;
  };
  it("offers copy, move and shortcut, and runs the chosen one", () => {
    expect(choose(["C:\\a\\x"], "C:\\b", "ここにコピー")).toHaveBeenCalledWith("copy", ["C:\\a\\x"], "C:\\b");
    expect(choose(["C:\\a\\x"], "C:\\b", "ここに移動")).toHaveBeenCalledWith("move", ["C:\\a\\x"], "C:\\b");
    expect(choose(["C:\\a\\x"], "C:\\b", "ショートカット")).toHaveBeenCalledWith("link", ["C:\\a\\x"], "C:\\b");
  });
  it("does nothing on cancel", () => {
    expect(choose(["C:\\a\\x"], "C:\\b", "キャンセル")).not.toHaveBeenCalled();
  });
  it("disables move when every item is already in the folder", () => {
    const move = (paths: string[], dest: string) =>
      rightDropItems(paths, dest, vi.fn()).find((i) => i.text?.startsWith("ここに移動"))?.disabled;
    expect(move(["C:\\a\\x", "C:\\a\\y"], "C:\\a")).toBe(true);
    expect(move(["C:\\a\\x", "C:\\b\\y"], "C:\\a")).toBe(false);
    expect(move(["C:\\a\\x"], "C:\\b")).toBe(false);
  });
});
