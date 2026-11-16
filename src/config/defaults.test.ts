// The default usr/*.xml (src-tauri/resources/usr) must only use commands Vesta has.
import { describe, expect, it } from "vitest";
import { isKnownCommand } from "../commands/registry";
import "./load"; // defines Option.Reload

const files = import.meta.glob<string>("../../src-tauri/resources/usr/*.xml", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("default usr/*.xml", () => {
  it("has all six files", () => {
    expect(Object.keys(files)).toHaveLength(6);
  });

  it("uses only known commands", () => {
    const unknown: string[] = [];
    for (const [file, xml] of Object.entries(files)) {
      for (const m of xml.matchAll(/command="([^"]+)"/g)) if (!isKnownCommand(m[1])) unknown.push(`${file}: ${m[1]}`);
    }
    expect(unknown).toEqual([]);
  });

  it("has no Avesta-only parts", () => {
    for (const [file, xml] of Object.entries(files)) expect(xml, file).not.toMatch(/xml-stylesheet|Avesta|cygwin|lamoo|takechi/i);
  });
});
