// Running a configured item (menu / toolbar / status bar / key binding / link bar).

import { backend } from "../api/backend";
import type { MenuItem } from "../config/types";
import { errorText } from "../model/input";
import { NO_MODS, type Mods } from "../model/navigation";
import { openExternal, setMessage } from "../state/actions";
import { selectedEntries } from "../state/selection";
import { getState } from "../state/store";
import { runCommand } from "./registry";

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

function currentContext() {
  const s = getState();
  const id = s.tabs.currentId;
  const p = id ? s.panes[id] : null;
  return {
    selected: p ? selectedEntries(p).map((e) => e.location) : [],
    current: p?.folder?.fsPath ?? null,
  };
}

export async function runItem(item: MenuItem, mods: Mods = NO_MODS) {
  if (item.command) {
    await runCommand(item.command, { mods });
  } else if (item.navigate) {
    await openExternal(item.navigate, mods);
  } else if (item.path) {
    await openExternal(item.path, mods);
  } else if (item.execute) {
    const { selected, current } = currentContext();
    const program = normalizeExecute(item.execute);
    if (isUrl(program)) {
      await backend.openItems([program]).catch((e) => setMessage(`${program}: ${errorText(e)}`));
      return;
    }
    try {
      const target = await backend.resolveLocation(program);
      const loc = target.kind === "file" ? target.location : target.folder.location;
      // Environment variables are expanded in what the settings file says, before the paths go
      // in: a file that happens to be named `%TEMP%.txt` must reach the program unchanged.
      const template = item.args?.includes("%") ? await backend.expandEnv(item.args) : (item.args ?? "");
      for (const args of expandArgs(template, selected, current)) {
        await backend.openItems([loc], undefined, args || undefined, current ?? undefined);
      }
    } catch (e) {
      setMessage(`${program}: ${errorText(e)}`);
    }
  }
}

/** Removes `_` access-key markers and `{*}` for display; returns the text and the access key. */
export function menuLabel(text: string | undefined): { label: string; accessKey: string | null } {
  const t = (text ?? "").replace("{*}", "");
  const i = t.indexOf("_");
  if (i < 0 || i === t.length - 1) return { label: t, accessKey: null };
  return { label: t.slice(0, i) + t.slice(i + 1), accessKey: t[i + 1].toLowerCase() };
}
