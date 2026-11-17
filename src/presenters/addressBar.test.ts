import { beforeEach, describe, expect, it } from "vitest";
import type { FolderInfo } from "../api/types";
import { iconUrl } from "../api/urls";
import { useConfig } from "../config/store";
import { emptyPane, getState, useStore } from "../state/store";
import { addressBarView } from "./addressBar";

const sources = () => ({ app: getState(), config: useConfig.getState() });

const folder = (over: Partial<FolderInfo> = {}): FolderInfo => ({
  location: "C:\\work",
  displayName: "work",
  fsPath: "C:\\work",
  parent: "C:\\",
  syncRoot: false,
  syncRootPath: null,
  ...over,
});

const show = (id: string, f: FolderInfo | null) =>
  useStore.setState({ panes: { ...getState().panes, [id]: { ...emptyPane(), folder: f } } });

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
});

describe("addressBarView", () => {
  it("is empty until the pane shows a folder", () => {
    expect(addressBarView("a")(sources())).toEqual({
      hasFolder: false,
      text: "",
      iconSrc: null,
      current: false,
      suggest: null,
      focusSeq: 0,
    });
    show("a", null);
    expect(addressBarView("a")(sources())).toMatchObject({ hasFolder: false, text: "", iconSrc: null });
  });

  it("shows the path, or the name of a folder without one", () => {
    show("a", folder());
    expect(addressBarView("a")(sources())).toMatchObject({
      hasFolder: true,
      text: "C:\\work",
      iconSrc: iconUrl("C:\\work"),
    });
    show("a", folder({ location: "::{20D04FE0-3AEA-1069-A2D8-08002B30309D}", displayName: "PC", fsPath: null }));
    expect(addressBarView("a")(sources()).text).toBe("PC");
  });

  it("takes the icon of the sync root the folder is in", () => {
    show("a", folder({ location: "C:\\Dropbox\\work", syncRootPath: "C:\\Dropbox" }));
    expect(addressBarView("a")(sources()).iconSrc).toBe(iconUrl("C:\\Dropbox"));
  });

  it("is current with its tab", () => {
    show("a", folder());
    useStore.setState({ tabs: { tabs: [], currentId: "a" } });
    expect(addressBarView("a")(sources()).current).toBe(true);
    expect(addressBarView("b")(sources()).current).toBe(false);
  });

  it("offers the suggestions of its own pane only", () => {
    show("a", folder());
    show("b", folder());
    useStore.setState({ suggest: { paneId: "a", parent: "C:\\work\\", names: ["docs", "src"] } });
    expect(addressBarView("a")(sources()).suggest).toEqual({ parent: "C:\\work\\", names: ["docs", "src"] });
    expect(addressBarView("b")(sources()).suggest).toBeNull();
    useStore.setState({ suggest: { paneId: "a", parent: "C:\\work\\", names: [] } });
    expect(addressBarView("a")(sources()).suggest).toBeNull();
  });

  it("passes on a request for the focus in its address field", () => {
    show("a", folder());
    useStore.setState({ focus: { paneId: "a", target: "address", seq: 7 } });
    expect(addressBarView("a")(sources()).focusSeq).toBe(7);
    expect(addressBarView("b")(sources()).focusSeq).toBe(0);
    useStore.setState({ focus: { paneId: "a", target: "list", seq: 8 } });
    expect(addressBarView("a")(sources()).focusSeq).toBe(0);
  });

  it("hands out the same object until something it draws changes", () => {
    show("a", folder());
    const view = addressBarView("a");
    const before = view(sources());
    useStore.setState({
      message: "x",
      suggest: { paneId: "b", parent: "D:\\", names: ["x"] },
      focus: { paneId: "b", target: "address", seq: 3 },
      panes: { a: { ...getState().panes.a, loading: true } },
    });
    expect(view(sources())).toBe(before);
    useStore.setState({ suggest: { paneId: "a", parent: "C:\\", names: ["work"] } });
    expect(view(sources())).not.toBe(before);
  });
});
