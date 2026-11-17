// docs/spec/commands.md must list exactly the commands the app has.
import { describe, expect, it } from "vitest";
import { commandNames, isKnownCommand, parseCommand } from "./registry";

const docs = import.meta.glob<string>("../../docs/spec/commands.md", { query: "?raw", import: "default", eager: true });
const doc = Object.values(docs)[0] ?? "";

/** Command cells of the tables: lines starting with "| `Name`" whose name contains a dot and no "=". */
const listed = [...doc.matchAll(/^\| `([^`]+)`/gm)]
  .map((m) => m[1])
  .filter((n) => n.includes(".") && !n.includes("=") && !n.startsWith("X."))
  .map((n) => n.replace("[n]", "[1]"));

describe("docs/spec/commands.md", () => {
  it("is found and lists commands", () => {
    expect(listed.length).toBeGreaterThan(50);
  });

  it("lists only commands that exist", () => {
    expect(listed.filter((n) => !isKnownCommand(n))).toEqual([]);
  });

  it("lists every command", () => {
    const documented = new Set(listed.map((n) => parseCommand(n).name));
    expect(commandNames().filter((n) => !documented.has(n))).toEqual([]);
  });
});
