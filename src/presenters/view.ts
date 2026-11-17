// Presenters: pure functions from what the app knows to what a view draws. A view reads its
// presenter's result with `useView` and draws it; it decides nothing (AGENTS.md「書き方」).

import { useConfig } from "../config/store";
import type { UiConfig } from "../config/types";
import { useStore, type AppState } from "../state/store";

/** What presenters read. */
export interface Sources {
  app: AppState;
  config: UiConfig;
}

export type Presenter<T> = (s: Sources) => T;

/**
 * A presenter that works its result out again only when one of its inputs is another value
 * (compared with `Object.is`). The same result object is handed out otherwise, which is what
 * keeps a view from drawing again when something unrelated changes.
 *
 * Every presenter given to `useView` must be made with this: a presenter that returned a fresh
 * object each time would have its view drawing without end.
 */
export function presenter<const In extends readonly unknown[], Out>(
  inputs: (s: Sources) => In,
  compute: (...inputs: { -readonly [K in keyof In]: In[K] }) => Out,
  /**
   * For a presenter whose inputs change often while its result seldom does (one that reads the
   * whole state): says when a new result is the same as the last one, which is then kept.
   */
  same?: (a: Out, b: Out) => boolean,
): Presenter<Out> {
  let last: { inputs: In; out: Out } | null = null;
  return (s) => {
    const now = inputs(s);
    if (last && last.inputs.length === now.length && last.inputs.every((v, i) => Object.is(v, now[i]))) return last.out;
    const out = compute(...(now as { -readonly [K in keyof In]: In[K] }));
    last = { inputs: now, out: last && same?.(last.out, out) ? last.out : out };
    return last.out;
  };
}

/** `same` for results that are flat objects or arrays of them: equal when every field is. */
export function sameFields<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a) as (keyof T)[];
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => {
    const x = a[k];
    const y = b[k];
    return Object.is(x, y) || (typeof x === "object" && typeof y === "object" && sameFields(x, y));
  });
}

/** The value of `p` for the current state; the view is drawn again when it changes. */
export function useView<T>(p: Presenter<T>): T {
  const config = useConfig();
  return useStore((app) => p({ app, config }));
}
