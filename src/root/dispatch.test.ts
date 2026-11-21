// Scenarios through the root: an input goes in, the state is looked at.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("../api/backend", () => ({
  backend: {
    listFolder: vi.fn(async (location: string) => ({
      folder: { location, displayName: location, fsPath: location },
      entries: [],
    })),
    diskFree: vi.fn(async () => null),
    watchFolders: vi.fn(async () => {}),
    writeState: vi.fn(async () => {}),
    clipboardGetFiles: vi.fn(async () => null),
    startDrag: vi.fn(async () => {}),
    showContextMenu: vi.fn(async () => null),
    keyState: vi.fn(async () => ({ ctrl: false, shift: false, alt: false })),
  },
}));

import { backend } from "../api/backend";
import type { Entry, FolderInfo } from "../api/types";
import { useConfig } from "../config/store";
import type { MenuItem } from "../config/types";
import { OPEN_GATE } from "../model/gate";
import type { Tab } from "../model/tabs";
import { DEFAULT_OPTIONS, emptyPane, getState, modeIn, setState, type PaneState } from "../state/store";
import { dispatch, keyDown, keyUp, pointerDown, windowBlur, type KeyInput } from "./dispatch";

function tab(id: string, shown = true): Tab {
  return {
    id,
    location: `C:\\${id}`,
    displayName: id,
    fsPath: `C:\\${id}`,
    shown,
    locked: false,
    back: [],
    forward: [],
  };
}

const entry = (name: string): Entry =>
  ({
    name,
    location: `C:\\a\\${name}`,
    isFolder: false,
    isLink: false,
    size: 1,
    modified: null,
    typeName: "",
    hidden: false,
  }) as Entry;

function pane(id: string, names: string[] = []): PaneState {
  const folder = { location: `C:\\${id}`, displayName: id, fsPath: `C:\\${id}`, parent: "C:\\" } as FolderInfo;
  return { ...emptyPane(), folder, entries: names.map(entry) };
}

const loc = (name: string) => `C:\\a\\${name}`;
const grid = { columns: 1, page: 5, horizontal: false };
const none = { ctrl: false, shift: false, alt: false };

function key(k: string, more: Partial<KeyInput> = {}): KeyInput {
  return {
    key: k,
    code: k.length === 1 ? `Key${k.toUpperCase()}` : k,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    inText: false,
    inList: true,
    at: { x: 100, y: 100 },
    ...more,
  };
}

const MENU: MenuItem[] = [
  { text: "ファイル(_F)", children: [{ text: "閉じる", command: "Current.Close" }] },
  { text: "編集(_E)", children: [{ text: "すべて選択", command: "Current.SelectAll" }] },
];

beforeEach(() => {
  vi.clearAllMocks();
  windowBlur(); // forgets a half-pressed Alt of the test before
  setState({
    tabs: { tabs: [tab("a"), tab("b", false)], currentId: "a" },
    panes: { a: pane("a", ["x.txt", "y.txt", "z.txt"]), b: pane("b") },
    options: DEFAULT_OPTIONS,
    dialog: null,
    popup: null,
    menuBarHot: null,
    addressEditing: null,
    native: false,
    focus: null,
    gate: OPEN_GATE,
    message: null,
    layout: {
      menuBar: [
        { x: 0, y: 20 },
        { x: 60, y: 20 },
      ],
      listWidths: {},
    },
  });
  useConfig.setState({
    menu: MENU,
    tool: [],
    status: [],
    link: [],
    keyForm: [{ modifier: "C", key: "W", item: { command: "Current.Close" } }],
    keyFolder: [
      { modifier: "", key: "delete", item: { command: "Current.Paste" } },
      { modifier: "", key: "F2", item: { command: "Current.Rename" } },
      { modifier: "C", key: "M", item: { text: "menu", children: [{ text: "one", command: "Current.SelectAll" }] } },
    ],
  });
});

const tabIds = () => getState().tabs.tabs.map((t) => t.id);
const selected = () => [...getState().panes.a.selected].map((l) => l.split("\\").pop()).sort();

describe("keys", () => {
  it("runs a key binding when nothing is in front of the panes", () => {
    expect(keyDown(key("w", { ctrlKey: true }))).toBe(true);
    expect(tabIds()).toEqual(["b"]);
  });

  it("leaves keys without a binding to whoever has the focus", () => {
    expect(keyDown(key("ArrowDown"))).toBe(false);
  });

  it("does not run bindings while typing in a text field", () => {
    expect(keyDown(key("w", { ctrlKey: true, inText: true }))).toBe(false);
    setState({ addressEditing: "a" });
    expect(keyDown(key("w", { ctrlKey: true }))).toBe(false);
    expect(tabIds()).toEqual(["a", "b"]);
  });

  it("uses the folder bindings only when the focus is in a list", () => {
    expect(keyDown(key("Delete", { code: "Delete", inList: false }))).toBe(false);
    expect(keyDown(key("Delete", { code: "Delete" }))).toBe(true);
  });

  it("opens the menu bound to a key where the root was told", () => {
    expect(keyDown(key("m", { ctrlKey: true, at: { x: 7, y: 9 } }))).toBe(true);
    expect(getState().popup).toMatchObject({ x: 7, y: 9 });
    expect(modeIn(getState()).kind).toBe("popup");
  });

  it("does not repeat a file operation for a held-down key", async () => {
    keyDown(key("Delete", { code: "Delete", repeat: true }));
    await Promise.resolve();
    expect(backend.clipboardGetFiles).not.toHaveBeenCalled();
    keyDown(key("Delete", { code: "Delete" }));
    await vi.waitFor(() => expect(backend.clipboardGetFiles).toHaveBeenCalledTimes(1));
  });
});

describe("dialog", () => {
  beforeEach(() => setState({ dialog: { kind: "pattern", initial: "*" } }));

  it("keeps key bindings from running behind it", () => {
    expect(keyDown(key("w", { ctrlKey: true }))).toBe(false);
    expect(tabIds()).toEqual(["a", "b"]);
  });

  it("closes on Escape and gives the focus back to the list", () => {
    expect(keyDown(key("Escape"))).toBe(true);
    expect(getState().dialog).toBeNull();
    expect(getState().focus).toMatchObject({ paneId: "a", target: "list" });
  });

  it("leaves Enter to its field, except where there is no OK button", () => {
    expect(keyDown(key("Enter"))).toBe(false);
    setState({ dialog: { kind: "about" } });
    expect(keyDown(key("Enter"))).toBe(true);
    expect(getState().dialog).toBeNull();
  });

  it("acts on what was confirmed, after closing", () => {
    dispatch({ type: "dialog.confirm", text: "y*", mods: none });
    expect(getState().dialog).toBeNull();
    expect(selected()).toEqual(["y.txt"]);
  });

  it("ignores Alt alone and commands from the bars", () => {
    keyDown(key("Alt", { altKey: true }));
    expect(keyUp("Alt")).toBe(false);
    dispatch({ type: "item", item: { command: "Current.Close" }, mods: none });
    expect(tabIds()).toEqual(["a", "b"]);
  });
});

describe("popup menu", () => {
  it("closes before the chosen item acts, and the list gets the focus back", () => {
    const order: string[] = [];
    const item = { text: "x", onSelect: () => order.push(getState().popup ? "open" : "closed") };
    dispatch({ type: "menu.open", items: [item], at: { x: 1, y: 2 } });
    expect(getState().popup).toMatchObject({ x: 1, y: 2 });
    dispatch({ type: "menu.select", item, mods: none });
    expect(order).toEqual(["closed"]);
    expect(getState().focus).toMatchObject({ paneId: "a", target: "list" });
  });

  it("closes on a press outside it, not on one inside", () => {
    dispatch({ type: "menu.open", items: [{ text: "x" }], at: { x: 0, y: 0 } });
    pointerDown(true, false);
    expect(getState().popup).not.toBeNull();
    pointerDown(false, false);
    expect(getState().popup).toBeNull();
  });

  it("closes when the window loses the focus", () => {
    dispatch({ type: "menu.open", items: [{ text: "x" }], at: { x: 0, y: 0 } });
    windowBlur();
    expect(getState().popup).toBeNull();
  });

  it("keeps the keys for itself", () => {
    dispatch({ type: "menu.open", items: [{ text: "x" }], at: { x: 0, y: 0 } });
    expect(keyDown(key("w", { ctrlKey: true }))).toBe(false);
    expect(tabIds()).toEqual(["a", "b"]);
  });
});

describe("menu bar", () => {
  const pressAlt = () => {
    keyDown(key("Alt", { altKey: true }));
    return keyUp("Alt");
  };

  it("is highlighted by Alt alone, and left by Alt again or a press of the mouse", () => {
    expect(pressAlt()).toBe(true);
    expect(getState().menuBarHot).toBe(0);
    pressAlt();
    expect(getState().menuBarHot).toBeNull();
    pressAlt();
    pointerDown(false, false);
    expect(getState().menuBarHot).toBeNull();
  });

  it("is not highlighted when Alt was used with another key", () => {
    keyDown(key("Alt", { altKey: true }));
    keyDown(key("x", { altKey: true }));
    expect(keyUp("Alt")).toBe(false);
    expect(getState().menuBarHot).toBeNull();
  });

  it("moves with the arrows and opens the menu where the bar said its item is", () => {
    pressAlt();
    expect(keyDown(key("ArrowRight"))).toBe(true);
    expect(getState().menuBarHot).toBe(1);
    expect(keyDown(key("Enter"))).toBe(true);
    expect(getState().popup).toMatchObject({ owner: "menu:1", x: 60, y: 20, byMouse: false });
    expect(getState().menuBarHot).toBeNull();
  });

  it("opens a menu with Alt+letter, replacing another popup", () => {
    dispatch({ type: "menu.open", items: [{ text: "x" }], at: { x: 5, y: 5 }, owner: "link:0" });
    expect(keyDown(key("e", { altKey: true }))).toBe(true);
    expect(getState().popup?.owner).toBe("menu:1");
  });

  it("goes to the neighbouring menu, and toggles with the mouse", () => {
    dispatch({ type: "menubar.press", index: 0 });
    expect(getState().popup).toMatchObject({ owner: "menu:0", byMouse: true });
    dispatch({ type: "menu.sibling", dir: -1 });
    expect(getState().popup?.owner).toBe("menu:1");
    dispatch({ type: "menubar.hover", index: 0 });
    expect(getState().popup?.owner).toBe("menu:0");
    dispatch({ type: "menubar.press", index: 0 });
    expect(getState().popup).toBeNull();
  });

  it("closes an open menu on Alt alone", () => {
    dispatch({ type: "menubar.press", index: 0 });
    pressAlt();
    expect(getState().popup).toBeNull();
    expect(getState().menuBarHot).toBeNull();
  });

  it("comes back with Alt alone when it is hidden", () => {
    setState({ options: { ...DEFAULT_OPTIONS, MenuVisible: false } });
    expect(keyDown(key("f", { altKey: true }))).toBe(false);
    pressAlt();
    expect(getState().options.MenuVisible).toBe(true);
    expect(getState().menuBarHot).toBeNull();
  });
});

describe("list", () => {
  it("selects on a press, toggles with Ctrl", () => {
    dispatch({ type: "list.press", id: "a", item: loc("x.txt"), mods: { ctrl: false, shift: false } });
    dispatch({ type: "list.press", id: "a", item: loc("z.txt"), mods: { ctrl: true, shift: false } });
    expect(selected()).toEqual(["x.txt", "z.txt"]);
  });

  it("keeps the selection while a selected item is pressed, and collapses it when released without a drag", () => {
    setState({
      panes: { ...getState().panes, a: { ...getState().panes.a, selected: new Set([loc("x.txt"), loc("y.txt")]) } },
    });
    dispatch({ type: "list.press", id: "a", item: loc("y.txt"), mods: { ctrl: false, shift: false } });
    expect(selected()).toEqual(["x.txt", "y.txt"]);
    expect(getState().panes.a.cursor).toBe(loc("y.txt"));
    dispatch({ type: "list.release", id: "a", item: loc("y.txt") });
    expect(selected()).toEqual(["y.txt"]);
  });

  it("drags the whole selection, and does not collapse it afterwards", async () => {
    setState({
      panes: { ...getState().panes, a: { ...getState().panes.a, selected: new Set([loc("x.txt"), loc("y.txt")]) } },
    });
    dispatch({ type: "list.press", id: "a", item: loc("y.txt"), mods: { ctrl: false, shift: false } });
    dispatch({ type: "list.drag", id: "a", item: loc("y.txt"), button: "left" });
    expect(backend.startDrag).toHaveBeenCalledWith([loc("x.txt"), loc("y.txt")]);
    expect(modeIn(getState()).kind).toBe("native");
    dispatch({ type: "list.release", id: "a", item: loc("y.txt") });
    expect(selected()).toEqual(["x.txt", "y.txt"]);
    await vi.waitFor(() => expect(getState().native).toBe(false));
  });

  it("does not drag an item that Ctrl has just taken out of the selection", () => {
    setState({ panes: { ...getState().panes, a: { ...getState().panes.a, selected: new Set([loc("x.txt")]) } } });
    dispatch({ type: "list.press", id: "a", item: loc("x.txt"), mods: { ctrl: true, shift: false } });
    dispatch({ type: "list.drag", id: "a", item: loc("x.txt"), button: "left" });
    expect(backend.startDrag).not.toHaveBeenCalled();
  });

  it("selects what a right-button drag starts on", () => {
    dispatch({ type: "list.drag", id: "a", item: loc("z.txt"), button: "right" });
    expect(selected()).toEqual(["z.txt"]);
    expect(backend.startDrag).toHaveBeenCalledWith([loc("z.txt")]);
  });

  it("does not open the context menu while a drag has the input", () => {
    setState({ native: true });
    dispatch({ type: "list.context", id: "a", item: loc("x.txt"), at: { x: 1, y: 1 } });
    expect(backend.showContextMenu).not.toHaveBeenCalled();
  });

  it("opens the Shell menu for the selection, or for the folder on empty space", () => {
    dispatch({ type: "list.context", id: "a", item: loc("x.txt"), at: { x: 3, y: 4 } });
    expect(backend.showContextMenu).toHaveBeenCalledWith("C:\\a", [loc("x.txt")], 3, 4);
    expect(selected()).toEqual(["x.txt"]);
  });

  it("moves the cursor, toggles with Space and jumps to a typed letter", () => {
    dispatch({ type: "list.key", id: "a", key: "ArrowDown", mods: none, grid });
    expect(getState().panes.a.cursor).toBe(loc("x.txt"));
    dispatch({ type: "list.key", id: "a", key: "ArrowDown", mods: { ...none, ctrl: true }, grid });
    expect(getState().panes.a.cursor).toBe(loc("y.txt"));
    dispatch({ type: "list.key", id: "a", key: " ", mods: none, grid });
    expect(selected()).toEqual(["x.txt", "y.txt"]);
    dispatch({ type: "list.key", id: "a", key: "z", mods: none, grid });
    expect(selected()).toEqual(["z.txt"]);
  });

  it("replaces the selection with what the marquee covers", () => {
    dispatch({ type: "list.press", id: "a", item: loc("x.txt"), mods: { ctrl: false, shift: false } });
    dispatch({ type: "list.pressEmpty", id: "a", additive: false });
    expect(selected()).toEqual([]);
    dispatch({ type: "list.marquee", id: "a", items: [loc("y.txt"), loc("z.txt")] });
    expect(selected()).toEqual(["y.txt", "z.txt"]);
  });

  it("changes the selected part of the name when the rename key is pressed again", () => {
    const f2 = (more: Partial<KeyInput> = {}) => keyDown(key("F2", { code: "F2", ...more }));
    dispatch({ type: "list.press", id: "a", item: loc("x.txt"), mods: { ctrl: false, shift: false } });
    expect(f2()).toBe(true);
    expect(getState().panes.a).toMatchObject({ renaming: loc("x.txt"), renamePart: "base" });
    // The focus is now in the rename box: a text field inside the list.
    expect(f2({ inText: true })).toBe(true);
    expect(getState().panes.a.renamePart).toBe("ext");
    expect(f2({ inText: true })).toBe(true);
    expect(getState().panes.a).toMatchObject({ renaming: loc("x.txt"), renamePart: "base" });
    // No other binding runs while the name is edited.
    expect(keyDown(key("Delete", { code: "Delete", inText: true }))).toBe(false);
    expect(keyDown(key("w", { ctrlKey: true, inText: true }))).toBe(false);
    expect(tabIds()).toEqual(["a", "b"]);
  });

  it("starts with the whole name selected when the option says so", () => {
    setState({ options: { ...DEFAULT_OPTIONS, RenameExtension: false } });
    dispatch({ type: "list.press", id: "a", item: loc("x.txt"), mods: { ctrl: false, shift: false } });
    keyDown(key("F2", { code: "F2" }));
    expect(getState().panes.a.renamePart).toBe("all");
    keyDown(key("F2", { code: "F2", inText: true }));
    expect(getState().panes.a.renamePart).toBe("ext");
  });

  it("ends a rename once, and gives the focus back to the list", () => {
    setState({ panes: { ...getState().panes, a: { ...getState().panes.a, renaming: loc("x.txt") } } });
    expect(modeIn(getState())).toEqual({ kind: "edit", paneId: "a", field: "rename" });
    dispatch({ type: "rename.end", id: "a", item: loc("x.txt"), name: null, refocus: true });
    expect(getState().panes.a.renaming).toBeNull();
    expect(getState().focus).toMatchObject({ paneId: "a", target: "list" });
    const seq = getState().focus?.seq;
    dispatch({ type: "rename.end", id: "a", item: loc("x.txt"), name: "again.txt", refocus: true });
    expect(getState().focus?.seq).toBe(seq);
  });
});

describe("tabs and panes", () => {
  it("shows only the clicked tab, or adds it with Ctrl", () => {
    dispatch({ type: "tab.click", id: "b", mods: { ...none, ctrl: true } });
    expect(getState().tabs.tabs.map((t) => t.shown)).toEqual([true, true]);
    dispatch({ type: "tab.click", id: "b", mods: none });
    expect(getState().tabs.tabs.map((t) => t.shown)).toEqual([false, true]);
    expect(getState().tabs.currentId).toBe("b");
  });

  it("moves a dragged tab to where the other one is", () => {
    dispatch({ type: "tab.dragOver", id: "a", over: "b" });
    expect(tabIds()).toEqual(["b", "a"]);
  });

  it("builds the tab menu, whose items act on the clicked tab", () => {
    dispatch({ type: "tab.context", id: "b", at: { x: 1, y: 1 } });
    const close = getState().popup?.items[0];
    expect(close?.text).toBe("閉じる(_C)");
    dispatch({ type: "menu.select", item: close!, mods: none });
    expect(tabIds()).toEqual(["a"]);
  });

  it("makes the pressed pane current, and keeps the dragged widths", () => {
    setState({ tabs: { tabs: [tab("a"), tab("b")], currentId: "a" } });
    dispatch({ type: "pane.widths", widths: { a: 0.7, b: 0.3 } });
    dispatch({ type: "pane.press", id: "b" });
    expect(getState().tabs.currentId).toBe("b");
    expect(getState().paneWidths).toEqual({ a: 0.7, b: 0.3 });
    dispatch({ type: "pane.arrange" });
    expect(getState().paneWidths).toBeNull();
  });

  it("notes the address bar being edited, and asks for the list when it is left", () => {
    dispatch({ type: "address.editing", id: "a", on: true });
    expect(modeIn(getState())).toEqual({ kind: "edit", paneId: "a", field: "address" });
    dispatch({ type: "address.cancel", id: "a" });
    expect(getState().focus).toMatchObject({ paneId: "a", target: "list" });
    dispatch({ type: "address.editing", id: "a", on: false });
    expect(modeIn(getState()).kind).toBe("idle");
  });
});
