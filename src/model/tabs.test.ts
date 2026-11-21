import { describe, expect, it } from "vitest";
import {
  addTab,
  applyTabMenu,
  tabMenu,
  clickTab,
  closeTabs,
  cycleCurrent,
  focusTab,
  moveTab,
  newlyShown,
  reuseTab,
  setShown,
  shownChanged,
  targetIds,
  toggleLock,
  toggleShown,
  wheelTabs,
  type Tab,
  type TabsState,
} from "./tabs";

function tab(id: string, shown = false, locked = false): Tab {
  return {
    id,
    location: `C:\\${id}`,
    displayName: id,
    fsPath: `C:\\${id}`,
    shown,
    locked,
    back: [],
    forward: [],
  };
}

function state(spec: string, current: string): TabsState {
  // spec: "a b* c! d*!"  (* = shown, ! = locked)
  const tabs = spec.split(" ").map((s) => tab(s.replace(/[*!]/g, ""), s.includes("*"), s.includes("!")));
  return { tabs, currentId: current };
}

const shownIds = (s: TabsState) => s.tabs.filter((t) => t.shown).map((t) => t.id);
const order = (s: TabsState) => s.tabs.map((t) => t.id);

describe("tab clicks", () => {
  it("plain click shows only that tab and focuses it", () => {
    const s = clickTab(state("a* b* c", "a"), "c");
    expect(shownIds(s)).toEqual(["c"]);
    expect(s.currentId).toBe("c");
  });

  it("plain click also hides locked tabs", () => {
    expect(shownIds(clickTab(state("a*! b*", "b"), "b"))).toEqual(["b"]);
  });

  it("ctrl+click shows a hidden tab and focuses it", () => {
    const s = toggleShown(state("a* b", "a"), "b");
    expect(shownIds(s)).toEqual(["a", "b"]);
    expect(s.currentId).toBe("b");
  });

  it("ctrl+click hides a shown tab and moves focus to the next shown tab", () => {
    const s = toggleShown(state("a* b* c*", "b"), "b");
    expect(shownIds(s)).toEqual(["a", "c"]);
    expect(s.currentId).toBe("c");
  });

  it("ctrl+click never hides the last shown tab", () => {
    const s0 = state("a* b", "a");
    expect(toggleShown(s0, "a")).toBe(s0);
  });

  it("double-click shows and toggles the lock", () => {
    const s = toggleLock(state("a* b", "a"), "b");
    expect(s.tabs[1]).toMatchObject({ shown: true, locked: true });
    expect(toggleLock(s, "b").tabs[1].locked).toBe(false);
  });
});

describe("newlyShown", () => {
  it("lists the tab that ctrl+click brought into view", () => {
    const s0 = state("a* b c", "a");
    expect(newlyShown(s0, toggleShown(s0, "b"))).toEqual(["b"]);
  });

  it("lists the tab a plain click switched to, not the one it hid", () => {
    const s0 = state("a* b", "a");
    expect(newlyShown(s0, clickTab(s0, "b"))).toEqual(["b"]);
  });

  it("leaves out a tab that was just added", () => {
    const s0 = state("a* b", "a");
    expect(newlyShown(s0, addTab(s0, tab("n"), "append", "tail"))).toEqual([]);
  });

  it("is empty when no hidden tab became shown", () => {
    const s0 = state("a* b* c", "a");
    expect(newlyShown(s0, s0)).toEqual([]);
    expect(newlyShown(s0, toggleShown(s0, "b"))).toEqual([]);
    expect(newlyShown(s0, focusTab(s0, "b"))).toEqual([]);
  });
});

describe("reuseTab", () => {
  it("applies the action to the open tab instead of adding one", () => {
    const s0 = state("a* b c", "a");
    expect(shownIds(reuseTab(s0, "b", "open"))).toEqual(["b"]);
    expect(shownIds(reuseTab(s0, "b", "append"))).toEqual(["a", "b"]);
    expect(reuseTab(s0, "b", "switch").currentId).toBe("b");
    expect(reuseTab(s0, "b", "replace").currentId).toBe("b");
    expect(reuseTab(s0, "b", "goto")).toBe(s0);
  });
});

describe("shownChanged", () => {
  it("is false when only the current tab or a hidden tab changes", () => {
    const s0 = state("a* b* c", "a");
    expect(shownChanged(s0, focusTab(s0, "b"))).toBe(false);
    expect(shownChanged(s0, toggleLock(s0, "a"))).toBe(false);
    expect(shownChanged(s0, closeTabs(s0, ["c"], true).state)).toBe(false);
  });

  it("is true when a tab is shown, hidden, closed or moved among the shown ones", () => {
    const s0 = state("a* b* c", "a");
    expect(shownChanged(s0, toggleShown(s0, "c"))).toBe(true);
    expect(shownChanged(s0, toggleShown(s0, "b"))).toBe(true);
    expect(shownChanged(s0, closeTabs(s0, ["b"], true).state)).toBe(true);
    expect(shownChanged(s0, moveTab(s0, "a", 2))).toBe(true);
  });
});

describe("show / focus", () => {
  it("hiding the current tab moves focus", () => {
    const s = setShown(state("a* b*", "a"), ["a"], false);
    expect(shownIds(s)).toEqual(["b"]);
    expect(s.currentId).toBe("b");
  });

  it("hiding everything keeps the current tab shown", () => {
    const s = setShown(state("a* b*", "b"), ["a", "b"], false);
    expect(shownIds(s)).toEqual(["b"]);
  });

  it("focus shows a hidden tab", () => {
    const s = focusTab(state("a* b", "a"), "b");
    expect(shownIds(s)).toEqual(["a", "b"]);
    expect(s.currentId).toBe("b");
  });

  it("cycles the current tab among shown tabs", () => {
    const s = state("a* b c* d*", "d");
    expect(cycleCurrent(s, 1).currentId).toBe("a");
    expect(cycleCurrent(s, -1).currentId).toBe("c");
  });
});

describe("closing", () => {
  it("selects targets relative to the current tab", () => {
    const s = state("a* b c* d", "c");
    expect(targetIds(s, "left")).toEqual(["a", "b"]);
    expect(targetIds(s, "right")).toEqual(["d"]);
    expect(targetIds(s, "hidden")).toEqual(["b", "d"]);
    expect(targetIds(s, "others")).toEqual(["a", "b", "d"]);
  });

  it("finds duplicates after the first occurrence", () => {
    const s = state("a* b c", "a");
    s.tabs[2] = { ...s.tabs[2], location: "c:\\A" };
    expect(targetIds(s, "duplicate")).toEqual(["c"]);
  });

  it("closing the current tab focuses the next shown tab", () => {
    const { state: s, closed } = closeTabs(state("a* b* c*", "b"), ["b"], true);
    expect(closed.map((t) => t.id)).toEqual(["b"]);
    expect(order(s)).toEqual(["a", "c"]);
    expect(s.currentId).toBe("c");
  });

  it("closing all shown tabs shows a remaining tab", () => {
    const { state: s } = closeTabs(state("a* b c*", "c"), ["a", "c"], true);
    expect(shownIds(s)).toEqual(["b"]);
    expect(s.currentId).toBe("b");
  });

  it("keeps locked tabs unless lockClose", () => {
    const s0 = state("a*! b*", "b");
    expect(order(closeTabs(s0, ["a", "b"], false).state)).toEqual(["a"]);
    expect(order(closeTabs(s0, ["a", "b"], true).state)).toEqual([]);
  });
});

describe("adding tabs", () => {
  const s0 = state("a* b", "a");

  it("open: new tab only shown and current", () => {
    const s = addTab(s0, tab("n"), "open", "tail");
    expect(order(s)).toEqual(["a", "b", "n"]);
    expect(shownIds(s)).toEqual(["n"]);
    expect(s.currentId).toBe("n");
  });

  it("append: shown, focus unchanged", () => {
    const s = addTab(s0, tab("n"), "append", "next");
    expect(order(s)).toEqual(["a", "n", "b"]);
    expect(shownIds(s)).toEqual(["a", "n"]);
    expect(s.currentId).toBe("a");
  });

  it("append into an empty state focuses the new tab", () => {
    const s = addTab({ tabs: [], currentId: null }, tab("n"), "append", "tail");
    expect(s.currentId).toBe("n");
  });

  it("reserve: hidden", () => {
    const s = addTab(s0, tab("n"), "reserve", "head");
    expect(order(s)).toEqual(["n", "a", "b"]);
    expect(shownIds(s)).toEqual(["a"]);
  });

  it("switch: shown and current", () => {
    const s = addTab(s0, tab("n"), "switch", "tail");
    expect(shownIds(s)).toEqual(["a", "n"]);
    expect(s.currentId).toBe("n");
  });

  it("replace: new current, old one unlocked and hidden", () => {
    const s = addTab(state("a*! b", "a"), tab("n"), "replace", "tail");
    expect(shownIds(s)).toEqual(["n"]);
    expect(s.tabs[0]).toMatchObject({ shown: false, locked: false });
    expect(s.currentId).toBe("n");
  });
});

describe("tab menu", () => {
  const texts = (s: TabsState, id: string) =>
    tabMenu(s, id).map((e) => (e ? `${e.text}${e.disabled ? " x" : ""}${e.checked ? " v" : ""}` : "-"));

  it("lists the actions, with what cannot be done disabled", () => {
    expect(texts(state("a* b! c", "a"), "a")).toEqual([
      "閉じる(_C)",
      "表示(_S) v",
      "ナビゲートロック(_L)",
      "-",
      "左側を閉じる(_E) x",
      "右側を閉じる(_R)",
      "他を閉じる(_O)",
      "表示中を閉じる(_W)",
      "非表示を閉じる(_H)",
      "すべて閉じる(_A)",
    ]);
    expect(texts(state("a* b!", "a"), "b")[2]).toBe("ナビゲートロック(_L) v");
    expect(texts(state("a*", "a"), "a")[8]).toBe("非表示を閉じる(_H) x");
    expect(tabMenu(state("a*", "a"), "gone")).toEqual([]);
  });

  it("counts left and right from the clicked tab, which becomes current", () => {
    const s = state("a* b c d", "a");
    const left = applyTabMenu(s, "c", { kind: "closeTarget", target: "left", relative: true });
    expect(left.close).toEqual(["a", "b"]);
    expect(left.state.currentId).toBe("c");
    const shown = applyTabMenu(s, "c", { kind: "closeTarget", target: "shown", relative: false });
    expect(shown.close).toEqual(["a"]);
    expect(shown.state).toBe(s);
  });

  it("closes, shows and locks the clicked tab", () => {
    const s = state("a* b", "a");
    expect(applyTabMenu(s, "b", { kind: "close" })).toEqual({ state: s, close: ["b"] });
    expect(shownIds(applyTabMenu(s, "b", { kind: "show" }).state)).toEqual(["a", "b"]);
    expect(applyTabMenu(s, "b", { kind: "lock" }).state.tabs[1].locked).toBe(true);
  });
});

describe("ordering", () => {
  it("moves a tab", () => {
    expect(order(moveTab(state("a b c", "a"), "a", 2))).toEqual(["b", "c", "a"]);
  });
});

describe("wheel", () => {
  it("with one shown tab, shows the next tab", () => {
    const s = wheelTabs(state("a b* c", "b"), 1);
    expect(shownIds(s)).toEqual(["c"]);
    expect(s.currentId).toBe("c");
  });

  it("with several shown tabs, swaps the current pane with the next unlocked hidden tab", () => {
    const s = wheelTabs(state("a* b*! c! d", "a"), 1);
    expect(shownIds(s)).toEqual(["b", "d"]);
    expect(s.currentId).toBe("d");
  });
});
