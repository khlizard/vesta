// What a settings item runs: programs, their arguments, link targets. Pure.
// Spec: docs/spec/config.md「execute と args」「link.xml」

import type { MenuItem } from "../config/types";

/**
 * `"path"` for a command line. Backslashes at the end are doubled: programs read `\"` as a
 * quote character, so `"C:\"` would swallow the closing quote and the arguments after it.
 */
export const quote = (s: string) => `"${s.replace(/\\+$/, (m) => m + m)}"`;

/**
 * Expands `{selected}`, `{current}` and `[selected]` in `args`.
 * Returns one argument string per process to start (`[selected]` starts one per item).
 */
export function expandArgs(args: string, selected: string[], current: string | null): string[] {
  // Function replacers: a `$` in a file name must not be read as a replacement pattern.
  // All placeholders are filled in one pass, so text that came from a file name is never scanned again.
  const fill = (one: string | null) =>
    args.replace(/\{selected\}|\{current\}|\[selected\]/g, (m) => {
      if (m === "{selected}") return selected.map(quote).join(" ");
      if (m === "{current}") return current ? quote(current) : "";
      return one === null ? "" : quote(one);
    });
  if (!args.includes("[selected]") || !selected.length) return [fill(null)];
  return selected.map((s) => fill(s));
}

/** `http://` / `https://`: opened in the browser as written, never treated as a path. */
export function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

/** Avesta writes `AVESTA/opt/x.bat` and `SYSTEM/cmd.exe`; normalise to backslashes (web addresses stay as they are). */
export function normalizeExecute(path: string): string {
  if (isUrl(path)) return path.trim();
  return path.replace(/\//g, "\\").replace(/¥/g, "\\");
}

/**
 * What a link.xml item runs once its `path` is resolved: a file with `args` is executed
 * with them; anything else is opened as before. Spec: docs/spec/config.md「link.xml」
 */
export function linkAction(location: string, isFolder: boolean, args: string | undefined): MenuItem {
  return !isFolder && args ? { execute: location, args } : { path: location };
}
