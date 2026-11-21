import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));

const { pruneItems, pruneBindings, unknownCommands } = await import("./load");

describe("pruneItems", () => {
  it("drops unknown commands, empty submenus and stray separators", () => {
    const items = [
      { separator: true },
      { text: "A", command: "Current.Go.Up" },
      { text: "B", command: "Tree.Sync" },
      { separator: true },
      { separator: true },
      { text: "Sub", children: [{ text: "x", command: "Preview.Show(toggle)" }] },
      { text: "Run", execute: "SYSTEM/cmd.exe" },
      { text: "Home", navigate: "HOME" },
      { separator: true },
    ];
    expect(pruneItems(items)).toEqual([
      { text: "A", command: "Current.Go.Up" },
      { separator: true },
      { text: "Run", execute: "SYSTEM/cmd.exe" },
      { text: "Home", navigate: "HOME" },
    ]);
  });

  it("keeps a command item whose submenu became empty", () => {
    const items = [{ text: "MRU", command: "File.MRU", children: [{ command: "Unknown.Thing" }] }];
    expect(pruneItems(items)).toEqual([{ text: "MRU", command: "File.MRU" }]);
  });

  it("keeps sequences of known commands", () => {
    expect(pruneItems([{ command: "Explorer.Import;Tab.Next" }])).toEqual([]);
    expect(pruneItems([{ command: "Duplicate.Close;Tab.Next" }])).toHaveLength(1);
  });
});

describe("pruneBindings", () => {
  it("drops bindings with unknown commands and keeps execute bindings", () => {
    const b = pruneBindings([
      { modifier: "C", key: "P", item: { command: "Preview.Show(toggle)" } },
      { modifier: "C", key: "E", item: { execute: "C:\\x.exe", args: "[selected]" } },
      {
        modifier: "CS",
        key: "F",
        item: { children: [{ text: "_A", command: "Address.Focus" }, { command: "Tree.Focus" }] },
      },
    ]);
    expect(b.map((x) => x.key)).toEqual(["E", "F"]);
    expect(b[1].item.children).toHaveLength(1);
  });
});

describe("unknownCommands", () => {
  it("lists each unknown command once, from menus, bars and key bindings", () => {
    const cfg = {
      menu: [{ text: "m", children: [{ command: "Tree.Sync" }, { command: "Current.Copy" }] }],
      tool: [{ command: "Tree.Sync" }],
      status: [],
      link: [{ path: "C:\\x" }],
      keyForm: [{ modifier: "C", key: "Q", item: { command: "Curent.Close" } }],
      keyFolder: [{ modifier: "", key: "F2", item: { command: "Current.Rename" } }],
    };
    expect(unknownCommands(cfg)).toEqual(["Tree.Sync", "Curent.Close"]);
  });
});
