// Path comparisons for file operations (Windows: case-insensitive, trailing separators ignored).

/** Normalized form for comparing locations. */
export const normPath = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();

/**
 * `items` without later repeats of a location. A folder listing can name an item twice when
 * the folder changes while it is read; rows are keyed by location, and a repeated key leaves
 * a stale row on screen.
 */
export function uniqueByLocation<T extends { location: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out = items.filter((e) => !seen.has(e.location) && seen.add(e.location));
  return out.length === items.length ? items : out;
}

/** Normalized parent folder of a location. */
export function parentPath(p: string): string {
  const n = normPath(p);
  const i = n.lastIndexOf("\\");
  return i > 0 ? n.slice(0, i) : n;
}

/** Splits `paths` into those already directly in `dest` (`same`) and the rest (`other`). */
export function splitByParent(paths: string[], dest: string): { same: string[]; other: string[] } {
  const d = normPath(dest);
  const same: string[] = [];
  const other: string[] = [];
  for (const p of paths) (parentPath(p) === d ? same : other).push(p);
  return { same, other };
}

/**
 * The volume a path is on, for "same drive?" checks: `c:` for a drive path, `\\server\share`
 * for a network path, "" for anything else (virtual locations).
 */
export function volumeRoot(p: string): string {
  const n = p.replace(/\//g, "\\").toLowerCase();
  let m = /^[a-z]:/.exec(n);
  if (m) return m[0];
  m = /^\\\\[^\\]+\\[^\\]+/.exec(n);
  return m ? m[0] : "";
}

/** True when both paths are on the same volume (a move between them is a rename, not a copy). */
export function sameVolume(a: string, b: string): boolean {
  const r = volumeRoot(a);
  return r !== "" && r === volumeRoot(b);
}
