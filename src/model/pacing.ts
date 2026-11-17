// Keeping slow work from piling up or holding everything else. Used for reading folders.

/**
 * `work`, but `fallback` if it has not finished within `ms`. The work itself goes on; only the
 * wait ends (a folder on a server that does not answer can take a minute to fail).
 */
export function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Wraps `run` so that, per key, it never runs twice at once. Calls made while it runs are folded
 * into one more run after it (with the newest argument that was given), and all of them finish
 * when that run does. A folder that keeps changing is then read again once, not once per change.
 */
export function oneAtATime<A>(
  run: (key: string, arg: A | undefined) => Promise<void>,
): (key: string, arg?: A) => Promise<void> {
  const busy = new Map<string, { again: boolean; arg: A | undefined; done: Promise<void> }>();
  return (key, arg) => {
    const b = busy.get(key);
    if (b) {
      b.again = true;
      if (arg !== undefined) b.arg = arg;
      return b.done;
    }
    const state = { again: false, arg: undefined as A | undefined, done: Promise.resolve() };
    state.done = (async () => {
      try {
        await run(key, arg);
        while (state.again) {
          const next = state.arg;
          state.again = false;
          state.arg = undefined;
          await run(key, next);
        }
      } finally {
        busy.delete(key);
      }
    })();
    busy.set(key, state);
    return state.done;
  };
}

/**
 * A write that is asked for often but only needs to happen once things settle: `soon` runs
 * `write` `ms` after the last call, `now` runs it at once (before closing or restarting).
 */
export function saveLater(ms: number, write: () => Promise<void>): { soon: () => void; now: () => Promise<void> } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const now = () => {
    clearTimeout(timer);
    return write();
  };
  return {
    soon: () => {
      clearTimeout(timer);
      timer = setTimeout(() => void now(), ms);
    },
    now,
  };
}
