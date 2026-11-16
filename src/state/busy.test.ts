import { describe, expect, it } from "vitest";
import { beginFileOp, endFileOp, mayClose } from "./busy";

describe("mayClose", () => {
  it("does not ask when nothing is running", () => {
    expect(mayClose(() => false)).toBe(true);
  });

  it("asks while an operation runs and follows the answer", () => {
    beginFileOp();
    expect(mayClose(() => false)).toBe(false);
    expect(mayClose(() => true)).toBe(true);
    endFileOp();
    endFileOp(); // one too many must not go negative
    expect(mayClose(() => false)).toBe(true);
  });
});
