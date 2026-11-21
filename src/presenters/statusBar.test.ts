import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("../api/backend", () => ({ backend: {} }));

import type { Entry } from "../api/types";
import { EMPTY_UI_CONFIG, useConfig } from "../config/store";
import type { MenuItem } from "../config/types";
import { statusText } from "../model/format";
import { DEFAULT_OPTIONS, emptyPane, getState, setState, useStore, type PaneState } from "../state/store";
import { statusBarView } from "./statusBar";

const initial = useStore.getState();

const view = () => statusBarView({ app: getState(), config: useConfig.getState() });

function setStatus(status: MenuItem[]) {
  useConfig.setState({ ...EMPTY_UI_CONFIG, status });
}

function entry(name: string, size: number): Entry {
  return { location: `C:\\a\\${name}`, name, isFolder: false, size } as Entry;
}

/** One tab "a" with this pane. */
function openPane(pane: Partial<PaneState>) {
  setState({
    tabs: {
      tabs: [
        {
          id: "a",
          location: "C:\\a",
          displayName: "a",
          fsPath: "C:\\a",
          shown: true,
          locked: false,
          back: [],
          forward: [],
        },
      ],
      currentId: "a",
    },
    panes: { a: { ...emptyPane(), ...pane } },
  });
}

beforeEach(() => {
  useStore.setState(initial, true);
  useConfig.setState(EMPTY_UI_CONFIG, true);
});

describe("statusBarView", () => {
  it("is empty without a pane", () => {
    expect(view()).toEqual({ text: "", update: null, buttons: [] });
  });

  it("counts what the current pane lists and what is selected", () => {
    const entries = [entry("x", 10), entry("y", 20), entry("z", 30)];
    openPane({ entries });
    expect(view().text).toBe(statusText({ total: 3, totalBytes: 60, selected: 0, selectedBytes: 0, disk: null }));
    openPane({ entries, selected: new Set([entries[1].location, entries[2].location]) });
    expect(view().text).toBe(statusText({ total: 3, totalBytes: 60, selected: 2, selectedBytes: 50, disk: null }));
  });

  it("shows a message in place of the counts", () => {
    openPane({ entries: [entry("x", 10)] });
    setState({ message: "コピーしました" });
    expect(view().text).toBe("コピーしました");
    setState({ message: "" });
    expect(view().text).toBe("");
  });

  it("offers a downloaded update", () => {
    expect(view().update).toBeNull();
    setState({ updateReady: "1.2.3" });
    const update = view().update;
    expect(update?.label).toBe("Vesta 1.2.3 に更新");
    expect(update?.item).toEqual({ command: "System.Update" });
  });

  it("presents the buttons: separator, icon or text, pressed, usable", () => {
    setStatus([{ text: "罫線", command: "Option.GridLine", image: 3 }, {}, { text: "上へ", command: "Current.Go.Up" }]);
    openPane({});
    const [grid, sep, up] = view().buttons;
    expect(sep).toEqual({ kind: "separator" });
    expect(grid).toMatchObject({ kind: "button", title: "罫線", image: 3, enabled: true, checked: false });
    // The pane shows no folder: there is nowhere to go up to.
    expect(up).toMatchObject({
      kind: "button",
      title: "上へ",
      image: null,
      text: "上へ",
      enabled: false,
      checked: false,
    });

    setState({ options: { ...DEFAULT_OPTIONS, GridLine: true } });
    expect(view().buttons[0]).toMatchObject({ checked: true });
  });

  it("returns the same object while nothing it shows changes", () => {
    setStatus([{ text: "罫線", command: "Option.GridLine" }]);
    openPane({ entries: [entry("x", 10)] });
    const before = view();
    expect(view()).toBe(before);
    // Something the status bar does not show.
    setState({ mru: ["C:\\b"] });
    expect(view()).toBe(before);
    setState({ options: { ...DEFAULT_OPTIONS, GridLine: true } });
    expect(view()).not.toBe(before);
  });
});
