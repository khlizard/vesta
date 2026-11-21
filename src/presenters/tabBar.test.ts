import { beforeEach, describe, expect, it } from "vitest";

import { EMPTY_UI_CONFIG, useConfig } from "../config/store";
import type { Tab } from "../model/tabs";
import { DEFAULT_OPTIONS, getState, setState, useStore } from "../state/store";
import { tabBarView } from "./tabBar";

const initial = useStore.getState();

const view = () => tabBarView({ app: getState(), config: useConfig.getState() });

function tab(id: string, fsPath: string | null, more: Partial<Tab> = {}): Tab {
  return {
    id,
    location: fsPath ?? id,
    displayName: id,
    fsPath,
    shown: true,
    locked: false,
    back: [],
    forward: [],
    ...more,
  };
}

beforeEach(() => {
  useStore.setState(initial, true);
  useConfig.setState(EMPTY_UI_CONFIG, true);
});

describe("tabBarView", () => {
  it("presents the tabs in their order, with their state", () => {
    setState({
      tabs: {
        tabs: [
          tab("a", "C:\\work"),
          tab("b", "D:\\data", { shown: false, locked: true }),
          tab("c", null, { displayName: "PC" }),
        ],
        currentId: "a",
      },
    });
    expect(view()).toEqual([
      { id: "a", label: "work", title: "C:\\work", shown: true, current: true, locked: false },
      { id: "b", label: "data", title: "D:\\data", shown: false, current: false, locked: true },
      // Not a folder of the file system: its name is all there is.
      { id: "c", label: "PC", title: "PC", shown: true, current: false, locked: false },
    ]);
  });

  it("tells tabs of the same name apart only with DistinguishTab", () => {
    const tabs = { tabs: [tab("a", "C:\\x\\src"), tab("b", "C:\\y\\src")], currentId: "b" };
    setState({ tabs, options: { ...DEFAULT_OPTIONS, DistinguishTab: true } });
    expect(view().map((t) => t.label)).toEqual(["x\\src", "y\\src"]);
    setState({ options: { ...DEFAULT_OPTIONS, DistinguishTab: false } });
    expect(view().map((t) => t.label)).toEqual(["src", "src"]);
  });

  it("returns the same object until the tabs change", () => {
    setState({ tabs: { tabs: [tab("a", "C:\\work")], currentId: "a" } });
    const before = view();
    setState({ message: "hello" });
    expect(view()).toBe(before);
    setState({ tabs: { tabs: [tab("a", "C:\\work", { locked: true })], currentId: "a" } });
    expect(view()).not.toBe(before);
    expect(view()[0].locked).toBe(true);
  });
});
