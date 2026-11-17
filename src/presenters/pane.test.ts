import { beforeEach, describe, expect, it } from "vitest";
import { useConfig } from "../config/store";
import { DEFAULT_VIEW, emptyPane, getState, useStore } from "../state/store";
import { paneView } from "./pane";

const sources = () => ({ app: getState(), config: useConfig.getState() });

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
});

describe("paneView", () => {
  it("says when the pane is not there yet", () => {
    expect(paneView("a")(sources())).toEqual({
      exists: false,
      mode: "details",
      current: false,
      loading: false,
      error: null,
    });
  });

  it("gives the view mode and whether the pane is the current one", () => {
    useStore.setState({
      panes: { a: emptyPane({ ...DEFAULT_VIEW, mode: "thumbnail" }), b: emptyPane() },
      tabs: { tabs: [], currentId: "a" },
    });
    expect(paneView("a")(sources())).toMatchObject({ exists: true, mode: "thumbnail", current: true });
    expect(paneView("b")(sources())).toMatchObject({ exists: true, mode: "details", current: false });
  });

  it("shows the error only when the folder is not being read", () => {
    useStore.setState({ panes: { a: { ...emptyPane(), error: "アクセスできません" } } });
    expect(paneView("a")(sources())).toMatchObject({ loading: false, error: "アクセスできません" });
    useStore.setState({ panes: { a: { ...emptyPane(), error: "アクセスできません", loading: true } } });
    expect(paneView("a")(sources())).toMatchObject({ loading: true, error: null });
  });

  it("hands out the same object until something it draws changes", () => {
    useStore.setState({ panes: { a: emptyPane() }, tabs: { tabs: [], currentId: "a" } });
    const view = paneView("a");
    const before = view(sources());
    // The selection belongs to the list, not to the pane's frame.
    useStore.setState({ panes: { a: { ...getState().panes.a, selected: new Set(["x"]) } }, message: "x" });
    expect(view(sources())).toBe(before);
    useStore.setState({ tabs: { tabs: [], currentId: "b" } });
    expect(view(sources())).not.toBe(before);
  });
});
