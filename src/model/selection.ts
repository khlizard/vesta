// Selection, cursor and list keys as pure functions. Spec: docs/spec/listing.md「選択」「マウス」

/** The part of a pane the selection rules read and change. */
export interface Sel {
  selected: Set<string>;
  cursor: string | null;
  /** Where a Shift range starts. */
  anchor: string | null;
}

export interface SelMods {
  ctrl: boolean;
  shift: boolean;
}

/** An item as the rules need it: where it is and what it is called. */
export interface Named {
  location: string;
  name: string;
}

// ---------------------------------------------------------------- mouse

/** Click on `location`. `order` is every location in display order. */
export function clickSelect(sel: Sel, order: string[], location: string, mods: SelMods): Partial<Sel> {
  if (mods.shift && sel.anchor) {
    const a = order.indexOf(sel.anchor);
    const b = order.indexOf(location);
    if (a >= 0 && b >= 0) {
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      return { selected: mods.ctrl ? new Set([...sel.selected, ...range]) : new Set(range), cursor: location };
    }
  }
  if (mods.ctrl) return { ...toggled(sel.selected, location), cursor: location };
  return only(location);
}

/** Right-click: keep the selection if the item is in it, else select only it. Empty space clears it. */
export function contextSelect(sel: Sel, location: string | null): Partial<Sel> {
  if (location === null) return { selected: new Set<string>() };
  if (sel.selected.has(location)) return { cursor: location };
  return only(location);
}

/**
 * What a left press on an item does at once. Pressing an item that is already selected, without
 * Ctrl or Shift, waits: the selection must stay for a drag, and collapses to that item only if
 * the button is released without one.
 */
export function pressOnItem(sel: Sel, location: string, mods: SelMods): "select" | "wait" {
  return sel.selected.has(location) && !mods.ctrl && !mods.shift ? "wait" : "select";
}

/**
 * The items a double-click on `location` opens: the whole selection when the item is part of
 * it, else that item.
 */
export function openTargets<T extends { location: string }>(selected: T[], item: T | undefined, location: string): T[] {
  if (selected.some((x) => x.location === location)) return selected;
  return item ? [item] : [];
}

// ---------------------------------------------------------------- keyboard

/** Space: toggles the item under the cursor. */
export function toggleAtCursor(sel: Sel): Partial<Sel> {
  return sel.cursor ? toggled(sel.selected, sel.cursor) : {};
}

export type CursorStep = number | "home" | "end";

/** How far a list key moves the cursor, in items; null when the key is not a movement key. */
export function keyStep(key: string, grid: { columns: number; page: number; horizontal: boolean }): CursorStep | null {
  switch (key) {
    case "ArrowUp":
      return -grid.columns;
    case "ArrowDown":
      return grid.columns;
    case "ArrowLeft":
      return grid.horizontal ? -1 : null;
    case "ArrowRight":
      return grid.horizontal ? 1 : null;
    case "PageUp":
      return -grid.page;
    case "PageDown":
      return grid.page;
    case "Home":
      return "home";
    case "End":
      return "end";
    default:
      return null;
  }
}

/** Items a PageUp/PageDown moves over: one row less than fits, times the columns. */
export function pageStep(bodyHeight: number, itemHeight: number, columns: number): number {
  return Math.max(1, Math.floor(bodyHeight / itemHeight) - 1) * columns;
}

/**
 * Keyboard cursor movement. Shift extends from the anchor, Ctrl moves only the cursor.
 * Empty when there is nothing to move over.
 */
export function moveSelect(sel: Sel, order: string[], step: CursorStep, mods: SelMods): Partial<Sel> {
  if (!order.length) return {};
  const last = order.length - 1;
  const cur = sel.cursor === null ? -1 : order.indexOf(sel.cursor);
  let next: number;
  if (step === "home") next = 0;
  else if (step === "end") next = last;
  else next = cur < 0 ? (step > 0 ? 0 : last) : Math.min(Math.max(cur + step, 0), last);
  const loc = order[next];
  if (mods.ctrl && !mods.shift) return { cursor: loc };
  if (mods.shift) {
    const anchor = sel.anchor ?? loc;
    const a = order.indexOf(anchor);
    return { cursor: loc, anchor, selected: new Set(order.slice(Math.min(a, next), Math.max(a, next) + 1)) };
  }
  return only(loc);
}

/** The next item after the cursor (wrapping) whose name starts with `prefix`; null when none does. */
export function prefixTarget(items: Named[], cursor: string | null, prefix: string): string | null {
  const cur = items.findIndex((e) => e.location === cursor);
  const lower = prefix.toLowerCase();
  for (let k = 1; k <= items.length; k++) {
    const e = items[(cur + k + items.length) % items.length];
    if (e.name.toLowerCase().startsWith(lower)) return e.location;
  }
  return null;
}

/** Selecting only `location` (what type-ahead and plain cursor moves end with). */
export function only(location: string): Sel {
  return { selected: new Set([location]), cursor: location, anchor: location };
}

/** Letters typed so far, and when the last one was typed. */
export interface TypeAhead {
  text: string;
  at: number;
}

const TYPE_AHEAD_MS = 1000;

/** Whether letters typed a moment ago are still being added to (Space is then a letter, not a toggle). */
export function isTyping(ta: TypeAhead, now: number): boolean {
  return ta.text !== "" && now - ta.at < TYPE_AHEAD_MS;
}

/**
 * A letter typed in the list. Returns the letters to remember and the prefix to jump to; the
 * prefix is null when the cursor already sits on an item matching what was typed so far.
 * Repeating one letter cycles through the items starting with it.
 */
export function typeLetter(
  ta: TypeAhead,
  key: string,
  now: number,
  cursorName: string | undefined,
): { next: TypeAhead; prefix: string | null } {
  const text = (isTyping(ta, now) ? ta.text : "") + key;
  const next = { text, at: now };
  const prefix = [...text].every((c) => c === text[0]) ? text[0] : text;
  if (prefix.length > 1 && cursorName?.toLowerCase().startsWith(prefix.toLowerCase())) return { next, prefix: null };
  return { next, prefix };
}

// ---------------------------------------------------------------- patterns

/** Wildcard patterns separated by `;` (`*.txt;*.md`), case-insensitive. */
export function patternToRegExp(pattern: string): RegExp {
  const parts = pattern
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, "."));
  return new RegExp(`^(?:${parts.join("|") || "(?!)"})$`, "i");
}

// ---------------------------------------------------------------- marquee

/** Scroll speed (px per frame) when the pointer is `distance` px past the edge zone. */
export function edgeScrollSpeed(distance: number): number {
  return Math.min(40, 3 + Math.floor(distance / 3));
}

function toggled(selected: Set<string>, location: string): Pick<Sel, "selected" | "anchor"> {
  const next = new Set(selected);
  if (next.has(location)) next.delete(location);
  else next.add(location);
  return { selected: next, anchor: location };
}
