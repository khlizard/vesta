// Running a configured item (menu / toolbar / status bar / key binding / link bar).

import { backend } from "../api/backend";
import type { MenuItem } from "../config/types";
import { expandArgs, isUrl, normalizeExecute } from "../model/execute";
import { errorText } from "../model/input";
import { NO_MODS, type Mods } from "../model/navigation";
import { setMessage } from "../state/message";
import { openExternal } from "../state/navigation";
import { selectedEntries } from "../state/selection";
import { currentPane } from "../state/store";
import { runCommand } from "./registry";

function currentContext() {
  const p = currentPane();
  return {
    selected: p ? selectedEntries(p).map((e) => e.location) : [],
    current: p?.folder?.fsPath ?? null,
  };
}

/** Runs a configured item. `repeat`: it comes from a key that is being held down. */
export async function runItem(item: MenuItem, mods: Mods = NO_MODS, repeat = false) {
  if (item.command) {
    await runCommand(item.command, { mods, repeat });
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
