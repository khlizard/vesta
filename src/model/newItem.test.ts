import { describe, expect, it } from "vitest";
import { newItemKind } from "./newItem";

describe("newItemKind", () => {
  it("creates a file when the name has an extension", () => {
    expect(newItemKind("a.txt")).toBe("file");
    expect(newItemKind("新しいテキスト ドキュメント.txt")).toBe("file");
    expect(newItemKind(".gitignore")).toBe("file");
    expect(newItemKind("v1.2")).toBe("file");
  });

  it("creates a folder otherwise", () => {
    expect(newItemKind("新しいフォルダー")).toBe("folder");
    expect(newItemKind("foo.")).toBe("folder");
    expect(newItemKind("  abc  ")).toBe("folder");
  });

  it("creates nothing for an empty name", () => {
    expect(newItemKind("")).toBeNull();
    expect(newItemKind("   ")).toBeNull();
  });
});
