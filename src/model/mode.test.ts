import { describe, expect, it } from "vitest";
import { admit, entered, left, OPEN_GATE, type Gate } from "./gate";
import {
  altAloneAllowed,
  commandsAllowed,
  modeOf,
  NO_ALT,
  routeKey,
  trackAlt,
  type AltEvent,
  type ModeSource,
} from "./mode";

const quiet: ModeSource = { dialog: false, popupOwner: null, native: false, editing: null, menuBarHot: false };
const editing = { paneId: "p1", field: "address" as const };

describe("modeOf", () => {
  it("is idle when nothing is in front of the panes", () => {
    expect(modeOf(quiet)).toEqual({ kind: "idle" });
  });

  it("takes what is in front first: dialog, popup, native, edit, menu bar", () => {
    const all: ModeSource = { dialog: true, popupOwner: "link:0", native: true, editing, menuBarHot: true };
    expect(modeOf(all).kind).toBe("dialog");
    expect(modeOf({ ...all, dialog: false })).toEqual({ kind: "popup", owner: "link:0" });
    expect(modeOf({ ...all, dialog: false, popupOwner: null }).kind).toBe("native");
    expect(modeOf({ ...all, dialog: false, popupOwner: null, native: false })).toEqual({ kind: "edit", ...editing });
    expect(modeOf({ ...quiet, menuBarHot: true }).kind).toBe("menubar");
  });

  it("counts a popup without an owner as a popup", () => {
    expect(modeOf({ ...quiet, popupOwner: "" })).toEqual({ kind: "popup", owner: "" });
  });
});

describe("routeKey", () => {
  const route = (s: Partial<ModeSource>, inText = false) => routeKey(modeOf({ ...quiet, ...s }), inText);

  it("gives keys to key bindings only when idle and outside text fields", () => {
    expect(route({})).toBe("bindings");
    expect(route({}, true)).toBe("text");
  });

  it("keeps keys away from what is behind a dialog, a popup or a native menu", () => {
    expect(route({ dialog: true })).toBe("dialog");
    expect(route({ dialog: true }, true)).toBe("dialog");
    expect(route({ popupOwner: "" })).toBe("popup");
    expect(route({ popupOwner: "", editing }, true)).toBe("popup");
    expect(route({ native: true })).toBe("none");
  });

  it("leaves keys to the field being edited, and to the highlighted menu bar", () => {
    expect(route({ editing })).toBe("text");
    expect(route({ menuBarHot: true })).toBe("menubar");
  });
});

describe("commandsAllowed / altAloneAllowed", () => {
  it("holds commands and Alt back behind a dialog and a native menu only", () => {
    for (const allowed of [commandsAllowed, altAloneAllowed]) {
      expect(allowed(modeOf(quiet))).toBe(true);
      expect(allowed(modeOf({ ...quiet, editing }))).toBe(true);
      expect(allowed(modeOf({ ...quiet, popupOwner: "" }))).toBe(true);
      expect(allowed(modeOf({ ...quiet, dialog: true }))).toBe(false);
      expect(allowed(modeOf({ ...quiet, native: true }))).toBe(false);
    }
  });
});

describe("trackAlt", () => {
  const down = (key: string, repeat = false): AltEvent => ({ type: "keydown", key, repeat });
  const up = (key: string): AltEvent => ({ type: "keyup", key });
  /** Runs the events in order; true when the last one reported Alt alone. */
  const run = (...events: AltEvent[]) => {
    let press = NO_ALT;
    let alone = false;
    for (const e of events) ({ press, alone } = trackAlt(press, e));
    return alone;
  };

  it("fires when Alt is pressed and released with nothing in between", () => {
    expect(run(down("Alt"), up("Alt"))).toBe(true);
    expect(run(down("Alt"), down("Alt", true), down("Alt", true), up("Alt"))).toBe(true);
  });

  it("does not fire when Alt was used with a key or the mouse", () => {
    expect(run(down("Alt"), down("f"), up("f"), up("Alt"))).toBe(false);
    expect(run(down("Alt"), { type: "pointerdown" }, up("Alt"))).toBe(false);
    expect(run(down("Alt"), down("Tab"), up("Alt"))).toBe(false);
  });

  it("does not count other modifiers going down as a use", () => {
    expect(run(down("Alt"), down("Shift"), up("Shift"), up("Alt"))).toBe(true);
  });

  it("needs to have seen Alt go down (the window got the focus with Alt held)", () => {
    expect(run(up("Alt"))).toBe(false);
    expect(run(down("a"), up("Alt"))).toBe(false);
  });

  it("starts afresh after each release", () => {
    expect(run(down("Alt"), down("f"), up("Alt"), down("Alt"), up("Alt"))).toBe(true);
  });
});

describe("gate", () => {
  const busy: Gate = { running: true, waiting: false };
  const full: Gate = { running: true, waiting: true };

  it("lets free commands through whatever is running", () => {
    expect(admit(full, "free", false)).toBe("run");
    expect(admit(full, "free", true)).toBe("run");
    expect(entered(full, "run", "free")).toBe(full);
  });

  it("runs an exclusive command at once when nothing is running", () => {
    expect(admit(OPEN_GATE, "exclusive", false)).toBe("run");
    expect(entered(OPEN_GATE, "run", "exclusive")).toEqual(busy);
  });

  it("lets one exclusive command wait, and drops the ones after it", () => {
    expect(admit(busy, "exclusive", false)).toBe("wait");
    expect(entered(busy, "wait", "exclusive")).toEqual(full);
    expect(admit(full, "exclusive", false)).toBe("drop");
    expect(entered(full, "drop", "exclusive")).toBe(full);
  });

  it("drops exclusive commands from a held-down key, even when nothing is running", () => {
    expect(admit(OPEN_GATE, "exclusive", true)).toBe("drop");
    expect(admit(busy, "exclusive", true)).toBe("drop");
  });

  it("hands over to the waiting command when the running one ends, else opens", () => {
    expect(left(full)).toEqual({ gate: busy, next: true });
    expect(left(busy)).toEqual({ gate: OPEN_GATE, next: false });
  });
});
