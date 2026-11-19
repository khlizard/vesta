import { beforeEach, describe, expect, it } from "vitest";
import type { Entry, FolderInfo } from "../api/types";
import { useConfig } from "../config/store";
import { DEFAULT_OPTIONS, DEFAULT_VIEW, emptyPane, useStore, type AppState, type PaneState } from "../state/store";
import { listView } from "./list";

function entry(name: string, more: Partial<Entry> = {}): Entry {
  return {
    name,
    location: `C:\\dir\\${name}`,
    isFolder: false,
    isLink: false,
    size: 1,
    modified: 0,
    created: 0,
    accessed: 0,
    attributes: 0,
    typeName: "",
    hidden: false,
    system: false,
    syncState: null,
    ...more,
  };
}

function folder(location: string, syncRoot = false): FolderInfo {
  return { location, displayName: location, fsPath: location, parent: null, syncRoot, syncRootPath: null };
}

function pane(more: Partial<PaneState> = {}): PaneState {
  return { ...emptyPane(), folder: folder("C:\\dir"), ...more };
}

const initial = useStore.getState();

/** Two panes, `a` current. */
function setup(a: Partial<PaneState> = {}, more: Partial<AppState> = {}) {
  useStore.setState(
    {
      ...initial,
      tabs: { ...initial.tabs, currentId: "a" },
      panes: { a: pane(a), b: pane() },
      ...more,
    },
    true,
  );
}

const read = (p: ReturnType<typeof listView>) => p({ app: useStore.getState(), config: useConfig.getState() });
const patch = (f: (s: AppState) => Partial<AppState>) => useStore.setState(f(useStore.getState()));
const patchPane = (id: string, more: Partial<PaneState>) =>
  patch((s) => ({ panes: { ...s.panes, [id]: { ...s.panes[id], ...more } } }));

beforeEach(() => setup());

describe("listView", () => {
  it("lists the items in display order, folders first", () => {
    setup({ entries: [entry("b.txt"), entry("a.txt"), entry("z", { isFolder: true })] });
    const v = read(listView("a"));
    expect(v.ord.entries.map((e) => e.name)).toEqual(["z", "a.txt", "b.txt"]);
    expect(v.ord.groups).toBeNull();
    expect(v.sortKey).toBe("name");
    expect(v.sortDesc).toBe(false);
  });

  it("follows the sort order and groups of the pane", () => {
    const entries = [entry("a.txt"), entry("b.txt"), entry("z", { isFolder: true })];
    setup({ entries, view: { ...DEFAULT_VIEW, sortDesc: true, grouping: true } });
    const v = read(listView("a"));
    expect(v.sortDesc).toBe(true);
    expect(v.ord.groups).not.toBeNull();
    expect(v.ord.groups!.flatMap((g) => g.entries)).toEqual(v.ord.entries);
    expect(v.ord.entries).toHaveLength(3);
    expect(v.ord.groups!.reduce((n, g) => n + g.entries.length, 0)).toBe(3);
  });

  it("hands over the selection, the cursor and the item being renamed", () => {
    const loc = "C:\\dir\\a.txt";
    setup({ entries: [entry("a.txt")], selected: new Set([loc]), cursor: loc, renaming: loc });
    const v = read(listView("a"));
    expect([...v.selected]).toEqual([loc]);
    expect(v.cursor).toBe(loc);
    expect(v.renaming).toBe(loc);
  });

  it("draws the status column only under a sync root", () => {
    const w = DEFAULT_OPTIONS.ColumnWidths;
    const plain = read(listView("a"));
    expect(plain.columns).toEqual(["name", "modified", "type", "size"]);
    expect(plain.totalWidth).toBe(w.name + w.modified + w.type + w.size);

    setup({ folder: folder("C:\\Dropbox", true) });
    const synced = read(listView("a"));
    expect(synced.columns).toEqual(["name", "status", "modified", "type", "size"]);
    expect(synced.totalWidth).toBe(w.name + w.status + w.modified + w.type + w.size);
  });

  it("follows the configured columns and widths", () => {
    setup({}, { options: { ...DEFAULT_OPTIONS, Columns: ["name", "size"], ColumnWidths: { ...DEFAULT_OPTIONS.ColumnWidths, name: 100, size: 50 } } });
    const v = read(listView("a"));
    expect(v.columns).toEqual(["name", "size"]);
    expect(v.widths.name).toBe(100);
    expect(v.totalWidth).toBe(150);
  });

  it("takes the options the views draw with", () => {
    setup({}, { options: { ...DEFAULT_OPTIONS, FullRowSelect: true, GridLine: true, FontSize: 16, ThumbnailSize: 128 } });
    const v = read(listView("a"));
    expect(v.fullRow).toBe(true);
    expect(v.gridLine).toBe(true);
    expect(v.rowHeight).toBe(24);
    expect(v.groupHeight).toBe(26);
    expect(v.thumbLabelHeight).toBe(40);
    expect(v.thumbSize).toBe(128);
    expect(v.renamePart).toBe("base");
  });

  it("says which pane is current and what folder it shows", () => {
    const a = read(listView("a"));
    expect(a.current).toBe(true);
    expect(a.folder).toBe("C:\\dir");
    expect(read(listView("b")).current).toBe(false);
  });

  it("passes on a focus request for its own list only", () => {
    const a = listView("a");
    expect(read(a).focusSeq).toBe(0);
    patch(() => ({ focus: { paneId: "a", target: "list", seq: 7 } }));
    expect(read(a).focusSeq).toBe(7);
    patch(() => ({ focus: { paneId: "a", target: "address", seq: 8 } }));
    expect(read(a).focusSeq).toBe(0);
    patch(() => ({ focus: { paneId: "b", target: "list", seq: 9 } }));
    expect(read(a).focusSeq).toBe(0);
  });

  it("wants the focus when it is current, loaded and nothing is in front", () => {
    const a = listView("a");
    expect(read(a).wantsFocus).toBe(true);
    expect(read(listView("b")).wantsFocus).toBe(false);

    patchPane("a", { loading: true });
    expect(read(a).wantsFocus).toBe(false);
    expect(read(a).loading).toBe(true);
    patchPane("a", { loading: false });
    expect(read(a).wantsFocus).toBe(true);

    patch(() => ({ dialog: { kind: "about" } }));
    expect(read(a).wantsFocus).toBe(false);
    patch(() => ({ dialog: null, popup: { items: [], x: 0, y: 0 } as unknown as AppState["popup"] }));
    expect(read(a).wantsFocus).toBe(false);
    patch(() => ({ popup: null, native: true }));
    expect(read(a).wantsFocus).toBe(false);
    patch(() => ({ native: false, addressEditing: "b" }));
    expect(read(a).wantsFocus).toBe(false);
    patch(() => ({ addressEditing: null, menuBarHot: 0 }));
    expect(read(a).wantsFocus).toBe(false);
    patch(() => ({ menuBarHot: null }));
    expect(read(a).wantsFocus).toBe(true);

    // A rename in any pane is an edit in progress.
    patchPane("b", { renaming: "C:\\dir\\x" });
    expect(read(a).wantsFocus).toBe(false);
  });

  it("returns the same object while nothing it reads changes", () => {
    const a = listView("a");
    const first = read(a);
    expect(read(a)).toBe(first);

    // Other panes and unrelated state do not make it anew.
    patchPane("b", { loading: true, entries: [entry("x")] });
    patch((s) => ({ message: "x", mru: ["C:\\"], options: { ...s.options, TwoRows: true } }));
    patch(() => ({ focus: { paneId: "b", target: "list", seq: 3 } }));
    expect(read(a)).toBe(first);

    patchPane("a", { cursor: "C:\\dir\\a.txt" });
    const second = read(a);
    expect(second).not.toBe(first);
    expect(second.cursor).toBe("C:\\dir\\a.txt");
    // The order is not worked out again for a change that does not touch it.
    expect(second.ord).toBe(first.ord);
  });

  it("draws an empty list for a pane that is gone", () => {
    const v = read(listView("gone"));
    expect(v.ord.entries).toEqual([]);
    expect(v.folder).toBeNull();
    expect(v.wantsFocus).toBe(false);
  });
});
