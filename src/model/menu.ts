// Menu labels as written in the settings files. Spec: docs/spec/config.md

/**
 * A label split around its access key: `ファイル(_F)` gives `ファイル(`, `F`, `)`. The `{*}`
 * marker is dropped. Without a `_` (or with one at the very end) the whole text is `before`.
 */
export function labelParts(text: string | undefined): { before: string; key: string; after: string } {
  const t = (text ?? "").replace("{*}", "");
  const i = t.indexOf("_");
  if (i < 0 || i === t.length - 1) return { before: t, key: "", after: "" };
  return { before: t.slice(0, i), key: t[i + 1], after: t.slice(i + 2) };
}

/** The label as plain text (for tooltips), and the access key in lower case. */
export function menuLabel(text: string | undefined): { label: string; accessKey: string | null } {
  const { before, key, after } = labelParts(text);
  return { label: before + key + after, accessKey: key ? key.toLowerCase() : null };
}

/**
 * The next item from `from` in direction `dir` that can be selected, wrapping round; `from`
 * itself when no other can (`from` may be -1: nothing selected yet).
 */
export function nextSelectable(count: number, from: number, dir: 1 | -1, selectable: (i: number) => boolean): number {
  let i = from;
  for (let k = 0; k < count; k++) {
    i = (i + dir + count) % count;
    if (selectable(i)) return i;
  }
  return from;
}

/** The first (`dir` 1) or last (`dir` -1) item that can be selected; -1 when none can. */
export function endSelectable(count: number, dir: 1 | -1, selectable: (i: number) => boolean): number {
  for (let k = 0; k < count; k++) {
    const i = dir === 1 ? k : count - 1 - k;
    if (selectable(i)) return i;
  }
  return -1;
}

/**
 * What pressing access key `key` does in a menu whose items have the access keys `keys`: the
 * only match is run; with several, the selection moves to the next one after `active`.
 */
export function accessKeyTarget(
  keys: (string | null)[],
  key: string,
  active: number,
  selectable: (i: number) => boolean,
): { run: number } | { select: number } | null {
  const hits = keys.flatMap((k, i) => (k === key && selectable(i) ? [i] : []));
  if (hits.length === 0) return null;
  if (hits.length === 1) return { run: hits[0] };
  return { select: hits.find((i) => i > active) ?? hits[0] };
}

/** What a key does while the menu bar is highlighted (after Alt alone). */
export type BarKeyResult =
  /** Highlight this item instead. */
  | { hot: number }
  /** Open this item's menu. */
  | { open: number }
  /** Stop highlighting the bar. */
  | { leave: true };

/**
 * A key pressed while item `hot` of the menu bar is highlighted. `accessKeys` are the access
 * keys of the bar's items. Null when the key means nothing to the bar.
 */
export function menuBarKey(
  hot: number,
  accessKeys: (string | null)[],
  key: string,
  ctrl: boolean,
): BarKeyResult | null {
  const n = accessKeys.length;
  if (n === 0) return null;
  switch (key) {
    case "ArrowRight":
      return { hot: (hot + 1) % n };
    case "ArrowLeft":
      return { hot: (hot - 1 + n) % n };
    case "ArrowDown":
    case "ArrowUp":
    case "Enter":
      return { open: hot };
    case "Escape":
      return { leave: true };
  }
  const i = barItemFor(accessKeys, key, ctrl);
  return i < 0 ? null : { open: i };
}

/** The menu bar item whose access key a pressed letter is; -1 when none (or Ctrl is held). */
export function barItemFor(accessKeys: (string | null)[], key: string, ctrl: boolean): number {
  if (key.length !== 1 || ctrl) return -1;
  return accessKeys.indexOf(key.toLowerCase());
}

/**
 * Where a menu of `size` goes so that it stays in the viewport. It is asked for at (x, y); one
 * that would pass the right edge moves to the left of its parent item (`parentLeft`, submenus)
 * or against the edge, one that would pass the bottom moves up.
 */
export function placeMenu(
  at: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  parentLeft?: number,
): { left: number; top: number } {
  let left = at.x;
  let top = at.y;
  if (left + size.width > viewport.width) {
    left = parentLeft !== undefined ? parentLeft - size.width + 2 : viewport.width - size.width;
  }
  if (top + size.height > viewport.height) top = Math.max(0, viewport.height - size.height);
  return { left: Math.max(0, left), top };
}
