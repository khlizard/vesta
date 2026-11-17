import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("../api/backend", () => ({ backend: {} }));

import type { FolderInfo } from "../api/types";
import { iconUrl } from "../api/urls";
import { EMPTY_UI_CONFIG, useConfig } from "../config/store";
import type { MenuItem } from "../config/types";
import { DEFAULT_OPTIONS, emptyPane, getState, setState, useStore } from "../state/store";
import { toolBarView, type ToolEntry } from "./toolBar";

const initial = useStore.getState();

const view = () => toolBarView({ app: getState(), config: useConfig.getState() });

type Button = Exclude<ToolEntry, { kind: "separator" }>;
function button(i: number): Button {
  const b = view()[i];
  if (b.kind === "separator") throw new Error(`entry ${i} is a separator`);
  return b;
}

function setTool(tool: MenuItem[]) {
  useConfig.setState({ ...EMPTY_UI_CONFIG, tool });
}

/** One tab "a" whose pane shows a folder with or without a parent. */
function openFolder(parent: string | null) {
  const folder = { location: "C:\\a", displayName: "a", fsPath: "C:\\a", parent } as FolderInfo;
  setState({
    tabs: {
      tabs: [{ id: "a", location: "C:\\a", displayName: "a", fsPath: "C:\\a", shown: true, locked: false, back: [], forward: [] }],
      currentId: "a",
    },
    panes: { a: { ...emptyPane(), folder } },
  });
}

beforeEach(() => {
  useStore.setState(initial, true);
  useConfig.setState(EMPTY_UI_CONFIG, true);
});

describe("toolBarView", () => {
  it("tells separators, buttons, split buttons and drop-downs apart", () => {
    const children: MenuItem[] = [{ text: "x", command: "Current.Go.Up" }];
    setTool([
      { text: "上へ(_U)", command: "Current.Go.Up", image: 0 },
      {},
      { text: "split", command: "Current.Go.Up", children },
      { text: "drop", children },
      { text: "mru", command: "File.MRU" },
    ]);
    expect(view().map((b) => b.kind)).toEqual(["button", "separator", "split", "drop", "split"]);
    expect(button(2).menu).toBe(children);
    expect(button(3).menu).toBe(children);
  });

  it("asks the command whether a button can be pressed", () => {
    setTool([{ text: "up", command: "Current.Go.Up" }, { text: "?", command: "No.Such.Command" }]);
    openFolder(null);
    expect(button(0).enabled).toBe(false);
    expect(button(1).enabled).toBe(false);
    openFolder("C:\\");
    expect(button(0).enabled).toBe(true);
  });

  it("does not make a split button usable because it has a drop-down", () => {
    setTool([{ text: "up", command: "Current.Go.Up", children: [{ text: "x" }] }, { text: "drop", children: [{ text: "x" }] }]);
    openFolder(null);
    expect(button(0).enabled).toBe(false);
    expect(button(1).enabled).toBe(true);
  });

  it("shows a ticked command as pressed", () => {
    setTool([{ text: "grid", command: "Option.GridLine" }]);
    expect(button(0).checked).toBe(false);
    setState({ options: { ...DEFAULT_OPTIONS, GridLine: true } });
    expect(button(0).checked).toBe(true);
  });

  it("lists the folders closed last under File.MRU", () => {
    setTool([{ text: "mru", command: "File.MRU" }]);
    expect(button(0).enabled).toBe(false);
    expect(button(0).menu).toEqual([]);
    setState({ mru: ["C:\\b", "C:\\c"] });
    expect(button(0).enabled).toBe(true);
    expect(button(0).menu).toEqual([
      { text: "C:\\b", literal: true, path: "C:\\b", iconSrc: iconUrl("C:\\b") },
      { text: "C:\\c", literal: true, path: "C:\\c", iconSrc: iconUrl("C:\\c") },
    ]);
  });

  it("gives the tooltip without the access key mark, and the command when there is no text", () => {
    setTool([{ text: "上へ(_U)", command: "Current.Go.Up" }, { command: "Current.Go.Up" }]);
    expect(button(0).title).toBe("上へ(U)");
    expect(button(1).title).toBe("Current.Go.Up");
  });

  it("picks the icon, else the text, else the fallback", () => {
    setTool([
      { text: "a", command: "Current.Go.Up", image: 9 },
      { text: "a", command: "Current.Go.Up", image: 99999 },
      { text: "a", command: "Current.Go.Up" },
      { command: "Current.Go.Up" },
    ]);
    expect(view().map((b) => b.kind !== "separator" && b.content)).toEqual(["icon", "text", "text", "fallback"]);
    expect(button(0).image).toBe(9);
  });

  it("returns the same object while nothing it shows changes", () => {
    setTool([{ text: "up", command: "Current.Go.Up" }, { text: "mru", command: "File.MRU" }]);
    openFolder("C:\\");
    setState({ mru: ["C:\\b"] });
    const before = view();
    expect(view()).toBe(before);
    // Something the tool bar does not show.
    setState({ message: "hello" });
    expect(view()).toBe(before);
    setState({ mru: ["C:\\b", "C:\\c"] });
    expect(view()).not.toBe(before);
  });
});
