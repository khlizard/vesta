// Saving and restoring the session (tabs, closed folders, window). Spec: docs/spec/ui.md「ウィンドウ」

import { backend } from "../api/backend";
import type { WindowPlacement } from "../api/types";
import { saveLater, within } from "../model/pacing";
import { buildSession, parseSession, placeholderFolder } from "../model/session";
import * as T from "../model/tabs";
import { getViewFor, saveViews } from "./folderViews";
import { saveFailed, setAsideBadState } from "./log";
import { reloadPane } from "./loading";
import { makeTab } from "./navigation";
import { saveOptions } from "./options";
import { emptyPane, getState, setState, type PaneState } from "./store";

/** The last known place of the window: from session.json at startup, then from each save. */
let lastWindow: WindowPlacement | null = null;

/**
 * False until startup has put the tabs back. Until then session.json must not be written:
 * the store still has no tabs, and writing would lose the saved ones.
 */
let sessionReady = false;

/** session.json: the tabs, the closed folders and where the window is. */
const saver = saveLater(1000, async () => {
  if (!sessionReady) return;
  lastWindow = (await backend.windowPlacement().catch(() => null)) ?? lastWindow;
  const s = getState();
  await backend
    .writeState("session", JSON.stringify(buildSession(s.tabs, s.mru, lastWindow)))
    .catch(saveFailed("session.json"));
});

const FLUSH_LIMIT_MS = 2000;

/** Writes everything that is waiting to be saved (before the window closes or the app restarts). */
export async function flushState() {
  const all = Promise.all([saver.now(), saveOptions(), saveViews()]).catch(() => {});
  // A stuck write must not keep the window from closing.
  await Promise.race([all, new Promise((done) => setTimeout(done, FLUSH_LIMIT_MS))]);
}

const RESOLVE_LIMIT_MS = 3000;

/** Puts back the tabs of the last run. False when there were none to restore. */
export async function restoreSession(): Promise<boolean> {
  const raw = await backend.readState("session").catch(() => null);
  if (!raw) return false;
  const session = parseSession(raw);
  if (!session) {
    // Kept aside: the first save of this run would otherwise overwrite the tabs it held.
    await setAsideBadState("session", "前回のタブ");
    return false;
  }
  lastWindow = session.window ?? null;
  setState({ mru: session.mru });
  if (!getState().options.RestoreCond || !session.tabs.length) return false;
  const tabs: T.Tab[] = [];
  const panes: Record<string, PaneState> = {};
  // A place that does not answer (a server that is off) must not hold the other tabs back:
  // after RESOLVE_LIMIT_MS its tab is made without it, like one that failed.
  const resolved = await Promise.all(
    session.tabs.map((t) =>
      within(
        backend.resolveLocation(t.location).catch(() => null),
        RESOLVE_LIMIT_MS,
        null,
      ),
    ),
  );
  session.tabs.forEach((st, i) => {
    const r = resolved[i];
    // A folder that cannot be reached now (offline share, unplugged drive) keeps its tab:
    // dropping it here would forget it at the next save. Reloading the pane tries again.
    const info = r?.kind === "folder" ? r.folder : placeholderFolder(st.location);
    const tab = { ...makeTab(info), shown: st.shown, locked: st.locked };
    tabs.push(tab);
    panes[tab.id] = emptyPane(getViewFor(info.location));
  });
  const cur = tabs[session.current]?.id ?? null;
  setState({ tabs: T.normalize({ tabs, currentId: cur }), panes });
  // Not waited for: the rest of startup (arguments, saving on close) must not depend on every
  // folder answering. Each pane fills in, or shows its error, when its listing comes back.
  for (const t of tabs) void reloadPane(t.id);
  return true;
}

/** Startup has put the tabs back: from now on session.json may be written. */
export function sessionRestored() {
  sessionReady = true;
}

/** Writes session.json shortly after the last change. */
export const saveSessionSoon = saver.soon;
