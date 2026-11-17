import { beforeEach, describe, expect, it } from "vitest";
import { useConfig } from "../config/store";
import type { Tab } from "../model/tabs";
import { DEFAULT_OPTIONS, getState, useStore } from "../state/store";
import { paneAreaView } from "./paneArea";

const tab = (id: string, shown = true): Tab => ({
  id,
  location: `C:\\${id}`,
  displayName: id,
  fsPath: `C:\\${id}`,
  shown,
  locked: false,
  back: [],
  forward: [],
});

const view = () => paneAreaView({ app: getState(), config: useConfig.getState() });

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
});

describe("paneAreaView", () => {
  it("puts the shown tabs in one row, evenly wide", () => {
    useStore.setState({ tabs: { tabs: [tab("a"), tab("b", false), tab("c")], currentId: "a" } });
    expect(view()).toEqual({ rows: [{ ids: ["a", "c"], fractions: [0.5, 0.5], height: 1 }], split: 0.5 });
  });

  it("uses the dragged widths, normalised", () => {
    useStore.setState({
      tabs: { tabs: [tab("a"), tab("b")], currentId: "a" },
      paneWidths: { a: 0.6, b: 0.2 },
    });
    const [row] = view().rows;
    expect(row.fractions[0]).toBeCloseTo(0.75);
    expect(row.fractions[1]).toBeCloseTo(0.25);
  });

  it("splits into two rows past TwoRowsMax, the upper one taking the odd pane", () => {
    useStore.setState({
      tabs: { tabs: ["a", "b", "c", "d", "e"].map((id) => tab(id)), currentId: "a" },
      options: { ...DEFAULT_OPTIONS, TwoRows: true, TwoRowsMax: 4 },
      paneRowSplit: 0.7,
    });
    const v = view();
    expect(v.rows.map((r) => r.ids)).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
    expect(v.split).toBe(0.7);
    expect(v.rows[0].height).toBe(0.7);
    expect(v.rows[1].height).toBeCloseTo(0.3);
    expect(v.rows[1].fractions).toEqual([0.5, 0.5]);
  });

  it("keeps one row when TwoRows is off or the panes fit", () => {
    const tabs = { tabs: ["a", "b", "c"].map((id) => tab(id)), currentId: "a" };
    useStore.setState({ tabs, options: { ...DEFAULT_OPTIONS, TwoRows: false, TwoRowsMax: 2 } });
    expect(view().rows).toHaveLength(1);
    useStore.setState({ options: { ...DEFAULT_OPTIONS, TwoRows: true, TwoRowsMax: 3 } });
    expect(view().rows).toHaveLength(1);
  });

  it("hands out the same object while the arrangement is the same", () => {
    useStore.setState({ tabs: { tabs: [tab("a"), tab("b")], currentId: "a" } });
    const before = view();
    expect(view()).toBe(before);
    // Another current tab, something unrelated: nothing to draw again.
    useStore.setState({ tabs: { ...getState().tabs, currentId: "b" }, message: "x" });
    expect(view()).toBe(before);
    useStore.setState({ paneWidths: { a: 0.3, b: 0.7 } });
    expect(view()).not.toBe(before);
  });
});
