import { afterEach, describe, expect, it, vi } from "vitest";

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
  },
}));

import { backend } from "../api/backend";
import type { FolderInfo } from "../api/types";
import { toggleShown, type Tab } from "../model/tabs";
import { setTabs, subscribe } from "./actions";
import { emptyPane, getState, setState } from "./store";

function tab(id: string, shown: boolean): Tab {
  return { id, location: `C:\\${id}`, displayName: id, fsPath: `C:\\${id}`, shown, locked: false, back: [], forward: [] };
}

function loadedPane(id: string) {
  const folder = { location: `C:\\${id}`, displayName: id, fsPath: `C:\\${id}` } as FolderInfo;
  return { ...emptyPane(), folder };
}

describe("showing a hidden tab", () => {
  let unsubscribe = () => {};
  afterEach(() => unsubscribe());

  it("reads its folder again exactly once", async () => {
    setState({
      tabs: { tabs: [tab("a", true), tab("b", false)], currentId: "a" },
      panes: { a: loadedPane("a"), b: loadedPane("b") },
    });
    unsubscribe = subscribe();
    vi.mocked(backend.listFolder).mockClear();

    setTabs((s) => toggleShown(s, "b"));
    await vi.waitFor(() => expect(getState().panes.b.loading).toBe(false));

    expect(backend.listFolder).toHaveBeenCalledTimes(1);
    expect(vi.mocked(backend.listFolder).mock.calls[0][0]).toBe("C:\\b");
  });
});
