import { beforeEach, describe, expect, it } from "vitest";
import { OPEN_GATE } from "../model/gate";
import { exclusive, mayClose } from "./exclusive";
import { getState, setState } from "./store";

/** A promise finished from outside. */
function gate() {
  let open!: () => void;
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open };
}

beforeEach(() => setState({ gate: OPEN_GATE, message: null }));

describe("exclusive", () => {
  it("runs one at a time, lets one wait, and drops the rest", async () => {
    const first = gate();
    const order: string[] = [];
    const a = exclusive(async () => {
      order.push("a starts");
      await first.wait;
      order.push("a ends");
      return "a";
    });
    const b = exclusive(async () => {
      order.push("b starts");
      return "b";
    });
    const c = exclusive(async () => {
      order.push("c starts");
      return "c";
    });
    expect(await c).toBeUndefined();
    expect(getState().message).toContain("前の操作が終わるまで");
    expect(order).toEqual(["a starts"]);

    first.open();
    expect(await a).toBe("a");
    expect(await b).toBe("b");
    expect(order).toEqual(["a starts", "a ends", "b starts"]);
    expect(getState().gate).toEqual(OPEN_GATE);
  });

  it("opens again after work that failed, and still starts the waiting one", async () => {
    const first = gate();
    const a = exclusive(async () => {
      await first.wait;
      throw new Error("failed");
    });
    const b = exclusive(async () => "b");
    first.open();
    await expect(a).rejects.toThrow("failed");
    expect(await b).toBe("b");
    expect(getState().gate).toEqual(OPEN_GATE);
  });
});

describe("mayClose", () => {
  it("does not ask when nothing is running", () => {
    expect(mayClose(() => false)).toBe(true);
  });

  it("asks while an operation runs and follows the answer", async () => {
    const running = gate();
    const work = exclusive(() => running.wait);
    expect(mayClose(() => false)).toBe(false);
    expect(mayClose(() => true)).toBe(true);
    running.open();
    await work;
    expect(mayClose(() => false)).toBe(true);
  });
});
