import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("../api/backend", () => ({ backend: {} }));

import { iconUrl } from "../api/urls";
import { EMPTY_UI_CONFIG, useConfig } from "../config/store";
import type { MenuItem } from "../config/types";
import { getState, setState, useStore, type LinkTarget } from "../state/store";
import { linkBarView } from "./linkBar";

const initial = useStore.getState();

const view = () => linkBarView({ app: getState(), config: useConfig.getState() });

function setLink(link: MenuItem[]) {
  useConfig.setState({ ...EMPTY_UI_CONFIG, link });
}

const folder = (location: string): LinkTarget => ({ location, isFolder: true, parent: "DESKTOP" });
const file = (location: string): LinkTarget => ({ location, isFolder: false, parent: "C:\\" });

beforeEach(() => {
  useStore.setState(initial, true);
  useConfig.setState(EMPTY_UI_CONFIG, true);
});

describe("linkBarView", () => {
  it("leaves the separators out and numbers the buttons", () => {
    setLink([{ text: "a", path: "C:\\a" }, {}, { text: "b", path: "C:\\b" }]);
    expect(view().map((b) => [b.index, b.label.before])).toEqual([
      [0, "a"],
      [1, "b"],
    ]);
  });

  it("shows a link not looked up yet without icon, mark or arrow", () => {
    setLink([{ text: "作業(_W)", path: "C:\\work" }]);
    expect(view()[0]).toEqual({
      index: 0,
      label: { before: "作業(", key: "W", after: ")" },
      title: "作業(W)",
      icon: null,
      missing: null,
      arrow: false,
    });
  });

  it("shows the icon of what was found, and an arrow for a folder", () => {
    setLink([{ text: "dir", path: "C:\\work" }, { text: "file", path: "C:\\a.txt" }, { text: "flat", path: "C:\\flat", depth: 0 }]);
    setState({ linkTargets: { "C:\\work": folder("C:\\work"), "C:\\a.txt": file("C:\\a.txt"), "C:\\flat": folder("C:\\flat") } });
    const [dir, f, flat] = view();
    expect(dir).toMatchObject({ icon: iconUrl("C:\\work"), missing: null, arrow: true });
    expect(f).toMatchObject({ icon: iconUrl("C:\\a.txt"), missing: null, arrow: false });
    // depth 0: the folder is opened, not listed.
    expect(flat).toMatchObject({ icon: iconUrl("C:\\flat"), arrow: false });
  });

  it("marks a link whose path was not found", () => {
    setLink([{ text: "gone", path: "X:\\gone" }, { text: "menu", path: "X:\\gone", children: [{ text: "c", path: "C:\\" }] }]);
    setState({ linkTargets: { "X:\\gone": null } });
    const [gone, menu] = view();
    expect(gone).toMatchObject({ icon: null, missing: "×", title: "見つかりません: X:\\gone", arrow: false });
    // Its own children can still be chosen.
    expect(menu).toMatchObject({ missing: "×", arrow: true });
  });

  it("gives a button without a path an arrow when it has children", () => {
    setLink([{ text: "group", children: [{ text: "c", path: "C:\\" }] }]);
    expect(view()[0]).toMatchObject({ icon: null, missing: null, arrow: true, title: "group" });
  });

  it("returns the same object until the links or their targets change", () => {
    setLink([{ text: "a", path: "C:\\a" }]);
    const before = view();
    setState({ message: "hello" });
    expect(view()).toBe(before);
    setState({ linkTargets: { "C:\\a": folder("C:\\a") } });
    expect(view()).not.toBe(before);
  });
});
