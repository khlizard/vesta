import { describe, expect, it } from "vitest";
import { addToMru, buildSession, parseSession, placeholderFolder } from "./session";
import type { TabsState } from "./tabs";

describe("placeholderFolder", () => {
  it("names the tab after the last part of a file-system path", () => {
    expect(placeholderFolder("D:\\work\\src\\")).toEqual({
      location: "D:\\work\\src\\",
      displayName: "src",
      fsPath: "D:\\work\\src\\",
    });
    expect(placeholderFolder("\\\\nas\\share").displayName).toBe("share");
    expect(placeholderFolder("\\\\nas\\share").fsPath).toBe("\\\\nas\\share");
  });

  it("has no path for a virtual location", () => {
    const f = placeholderFolder("::{645FF040-5081-101B-9F08-00AA002F954E}");
    expect(f.fsPath).toBeNull();
    expect(f.displayName).toBe("::{645FF040-5081-101B-9F08-00AA002F954E}");
  });
});

describe("addToMru", () => {
  it("puts the newest first and keeps each place once", () => {
    expect(addToMru(["C:\\a", "C:\\b"], ["c:\\B\\", "C:\\c"])).toEqual(["C:\\c", "c:\\B\\", "C:\\a"]);
  });

  it("keeps ten places", () => {
    const many = Array.from({ length: 12 }, (_, i) => `C:\\${i}`);
    expect(addToMru([], many)).toHaveLength(10);
    expect(addToMru([], many)[0]).toBe("C:\\11");
  });
});

const tab = (id: string, shown = true, locked = false) => ({
  id,
  location: `C:/${id}`,
  displayName: id,
  shown,
  locked,
});
const tabs = { tabs: [tab("a"), tab("b", false, true)], currentId: "b" } as unknown as TabsState;
const win = { x: 10, y: 20, width: 800, height: 600, maximized: true };

describe("buildSession", () => {
  it("writes the tabs, the current index and the closed folders", () => {
    expect(buildSession(tabs, ["C:/x"], null)).toEqual({
      tabs: [
        { location: "C:/a", shown: true, locked: false },
        { location: "C:/b", shown: false, locked: true },
      ],
      current: 1,
      mru: ["C:/x"],
    });
  });

  it("includes the window when it is known", () => {
    expect(buildSession(tabs, [], win).window).toEqual(win);
    expect("window" in buildSession(tabs, [], null)).toBe(false);
  });
});

describe("parseSession", () => {
  it("round-trips what buildSession writes", () => {
    const s = buildSession(tabs, ["C:/x"], win);
    expect(parseSession(JSON.stringify(s))).toEqual(s);
  });

  it("reads a file written before the window was saved", () => {
    const s = parseSession('{"tabs":[{"location":"C:/a","shown":true,"locked":false}],"current":0,"mru":[]}');
    expect(s?.tabs).toHaveLength(1);
    expect(s?.window).toBeUndefined();
  });

  it("rejects what is not a session", () => {
    expect(parseSession("{")).toBeNull();
    expect(parseSession("[]")).toBeNull();
    expect(parseSession("null")).toBeNull();
  });

  it("fills in missing parts and drops a malformed window", () => {
    expect(parseSession('{"window":{"x":1,"y":2,"width":"wide","height":3,"maximized":false}}')).toEqual({
      tabs: [],
      current: 0,
      mru: [],
    });
  });
});

describe("parseSession with damaged entries", () => {
  it("drops tabs and closed folders that are not usable", () => {
    const s = parseSession(
      '{"tabs":[null,5,{"location":""},{"location":"C:/a","shown":"yes"},{"shown":true}],"current":"x","mru":[1,"C:/x",""]}',
    );
    expect(s).toEqual({ tabs: [{ location: "C:/a", shown: false, locked: false }], current: 0, mru: ["C:/x"] });
  });
});
