// Carrying out what the root decided: failures go to the status bar, and a Shell menu or a
// drag marks the time it has the input. Used by dispatch.ts, menus.ts and keys.ts.

import { backend } from "../api/backend";
import { runCommand } from "../commands/registry";
import { verbCommand } from "../model/fileOps";
import { errorText } from "../model/input";
import { NO_MODS } from "../model/navigation";
import { setMessage } from "../state/message";
import { getState, modeIn, setState } from "../state/store";
import type { Point } from "./events";

export const mode = () => modeIn(getState());

/** Runs something that may fail, showing the reason in the status bar. */
export function attempt(work: Promise<unknown>) {
  work.catch((e) => setMessage(errorText(e)));
}

// ---------------------------------------------------------------- native menus and drags

/** After a right-button drag the Shell may still send the click that would open a context menu. */
export const RIGHT_DRAG_TAIL_MS = 100;

/** Marks the time a Shell menu or a drag has the input, so nothing else is started meanwhile. */
export async function native<T>(work: Promise<T>, tailMs = 0): Promise<T> {
  setState({ native: true });
  try {
    return await work;
  } finally {
    if (tailMs) setTimeout(() => setState({ native: false }), tailMs);
    else setState({ native: false });
  }
}

/** The Shell context menu for `items` of `folder`; the verbs it leaves to the app run as commands. */
export async function shellMenu(folder: string, items: string[], at: Point) {
  const verb = await native(backend.showContextMenu(folder, items, at.x, at.y));
  const command = verbCommand(verb, verb === "delete" && (await backend.keyState()).shift);
  if (command) await runCommand(command, { mods: NO_MODS });
}
