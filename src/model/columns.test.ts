import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLUMNS,
  dropIndex,
  moveColumn,
  moveShownColumn,
  normalizeColumns,
  toggleColumn,
  visibleColumns,
} from "./columns";

describe("columns", () => {
  it("normalizes saved columns", () => {
    expect(normalizeColumns(undefined)).toEqual(DEFAULT_COLUMNS);
    expect(normalizeColumns("x")).toEqual(DEFAULT_COLUMNS);
    expect(normalizeColumns(["size", "bogus", "size", 3, "name", "created"])).toEqual(["name", "size", "created"]);
    expect(normalizeColumns([])).toEqual(["name"]);
  });

  it("shows status only under sync roots", () => {
    expect(visibleColumns(DEFAULT_COLUMNS, false)).toEqual(["name", "modified", "type", "size"]);
    expect(visibleColumns(DEFAULT_COLUMNS, true)).toEqual(DEFAULT_COLUMNS);
  });

  it("toggles columns, adding to the right end and keeping name", () => {
    expect(toggleColumn(["name", "size"], "created")).toEqual(["name", "size", "created"]);
    expect(toggleColumn(["name", "size", "created"], "size")).toEqual(["name", "created"]);
    expect(toggleColumn(["name", "size"], "name")).toEqual(["name", "size"]);
  });

  it("moves columns but never left of name", () => {
    const c = ["name", "modified", "type", "size"] as const;
    expect(moveColumn(c, "size", 1)).toEqual(["name", "size", "modified", "type"]);
    expect(moveColumn(c, "modified", 4)).toEqual(["name", "type", "size", "modified"]);
    expect(moveColumn(c, "modified", 3)).toEqual(["name", "type", "modified", "size"]);
    expect(moveColumn(c, "type", 2)).toEqual(c);
    expect(moveColumn(c, "size", 0)).toEqual(["name", "size", "modified", "type"]);
    expect(moveColumn(c, "name", 3)).toEqual(c);
  });

  it("maps drop positions in the drawn columns to the configured list", () => {
    const cfg = ["name", "status", "modified", "type", "size"] as const;
    const shown = ["name", "modified", "type", "size"] as const;
    // Drop "size" before "modified" (drawn index 1): it lands before modified, after the hidden status.
    expect(moveShownColumn(cfg, shown, "size", 1)).toEqual(["name", "status", "size", "modified", "type"]);
    expect(moveShownColumn(cfg, shown, "modified", 4)).toEqual(["name", "status", "type", "size", "modified"]);
  });

  it("finds the insertion index from the pointer position", () => {
    const w = [100, 50, 50];
    expect(dropIndex(w, 10)).toBe(0);
    expect(dropIndex(w, 60)).toBe(1);
    expect(dropIndex(w, 130)).toBe(2);
    expect(dropIndex(w, 190)).toBe(3);
  });
});
