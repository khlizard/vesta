import { afterEach, describe, expect, it, vi } from "vitest";
import { oneAtATime, within } from "./pacing";

afterEach(() => vi.useRealTimers());

/** A promise finished from outside. */
function gate() {
  let open!: () => void;
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open };
}

describe("within", () => {
  it("gives the result when the work is in time", async () => {
    vi.useFakeTimers();
    const got = within(Promise.resolve("done"), 3000, "late");
    await vi.advanceTimersByTimeAsync(0);
    await expect(got).resolves.toBe("done");
  });

  it("gives the fallback when the work takes too long", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const got = within(never, 3000, "late");
    await vi.advanceTimersByTimeAsync(2999);
    let settled = false;
    void got.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(got).resolves.toBe("late");
  });

  it("passes a failure on", async () => {
    await expect(within(Promise.reject(new Error("no")), 3000, "late")).rejects.toThrow("no");
  });
});

describe("oneAtATime", () => {
  it("folds calls made during a run into one more run", async () => {
    const gates = [gate(), gate()];
    const runs: (string | undefined)[] = [];
    const call = oneAtATime<string>(async (_key, arg) => {
      const g = gates[runs.length];
      runs.push(arg);
      await g.wait;
    });
    const first = call("a");
    const second = call("a", "x");
    const third = call("a");
    const fourth = call("a", "y");
    expect(runs).toEqual([undefined]);
    gates[0].open();
    await Promise.resolve();
    await Promise.resolve();
    // One more run for the three calls, with the newest argument given.
    expect(runs).toEqual([undefined, "y"]);
    let finished = 0;
    for (const p of [first, second, third, fourth]) void p.then(() => finished++);
    await Promise.resolve();
    expect(finished).toBe(0);
    gates[1].open();
    await Promise.all([first, second, third, fourth]);
    expect(runs.length).toBe(2);
  });

  it("keeps keys apart", async () => {
    const g = gate();
    const runs: string[] = [];
    const call = oneAtATime(async (key) => {
      runs.push(key);
      await g.wait;
    });
    const a = call("a");
    const b = call("b");
    expect(runs).toEqual(["a", "b"]);
    g.open();
    await Promise.all([a, b]);
  });

  it("runs again after a run has finished, and after one that failed", async () => {
    let n = 0;
    const call = oneAtATime(async () => {
      n++;
      if (n === 1) throw new Error("first fails");
    });
    await expect(call("a")).rejects.toThrow("first fails");
    await call("a");
    await call("a");
    expect(n).toBe(3);
  });
});
