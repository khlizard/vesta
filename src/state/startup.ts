// Startup, and what follows the store from then on (watching, saving, reloading).

import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { backend } from "../api/backend";
import { sameLocation } from "../model/paths";
import * as T from "../model/tabs";
import { mayClose } from "./exclusive";
import { loadViews } from "./folderViews";
import { logLine } from "./log";
import { reloadPane } from "./loading";
import { openExternal } from "./navigation";
import { flushState, restoreSession, saveSessionSoon, sessionRestored } from "./session";
import { getState, setState, useStore } from "./store";
import { paneLocation, syncWatches } from "./watching";

/** Opens folders (and runs files) named on a command line, one after another. */
async function openPaths(paths: string[]) {
  for (const p of paths) await openExternal(p);
}

let started = false;

/** Called once at startup. */
export async function startApp() {
  if (started) return;
  started = true;
  subscribe();
  // Each step may fail on its own (a damaged file, an unreachable folder); the rest still runs,
  // so the window always ends up usable, saving works and the caller can go on to the update check.
  const step = async (what: string, f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (e) {
      logLine(`startup: ${what}`, e);
    }
  };
  await step("folder events", () =>
    listen<{ location: string }>("folder-changed", (ev) => {
      const s = getState();
      for (const id of Object.keys(s.panes)) {
        const at = paneLocation(s, id);
        if (at && sameLocation(at, ev.payload.location)) void reloadPane(id);
      }
    }),
  );
  await step("folder views", loadViews);
  let restored = false;
  await step("session", async () => {
    restored = await restoreSession();
  });
  sessionRestored();
  // Paths on the command line open on top of the restored tabs; a second start sends its
  // paths here through the "open-paths" event (single instance).
  let asked: string[] = [];
  await step("arguments", async () => {
    asked = await backend.startupPaths();
    await openPaths(asked);
  });
  await step("argument events", () => listen<string[]>("open-paths", (ev) => void openPaths(ev.payload)));
  if (!restored && !getState().tabs.tabs.length) await step("home", () => openExternal("HOME"));
  await step("window events", watchWindow);
}

/**
 * Saves where the window is when it moves, and writes everything when it closes.
 * Registered only after the session is restored: closing during startup must not
 * overwrite session.json with no tabs.
 */
async function watchWindow() {
  const win = getCurrentWindow();
  await win.onMoved(saveSessionSoon).catch((e) => logLine("window move events", e));
  await win.onResized(saveSessionSoon).catch((e) => logLine("window resize events", e));
  // The window is destroyed after this handler returns, unless the close is cancelled.
  await win
    .onCloseRequested(async (event) => {
      if (!mayClose()) {
        event.preventDefault();
        return;
      }
      await flushState();
    })
    // Without this handler nothing is written when the window closes.
    .catch((e) => logLine("window close events", e));
}

/**
 * Reacts to store changes: reloads panes that come into view, arranges the panes evenly when
 * the shown tabs change, follows them with the watcher, saves the session.
 */
export function subscribe(): () => void {
  let prevTabs = getState().tabs;
  let prevPanes = getState().panes;
  let prevMru = getState().mru;
  return useStore.subscribe((s) => {
    // Remember the new state before acting on it: the work below changes the store, which calls
    // this listener again from inside. It must then see this change as already handled, or it
    // would start the same reload over and over.
    const before = { tabs: prevTabs, panes: prevPanes, mru: prevMru };
    prevTabs = s.tabs;
    prevPanes = s.panes;
    prevMru = s.mru;
    if (s.tabs !== before.tabs) {
      // A hidden pane is not watched, so its list may be old: read it again when it is shown.
      for (const id of T.newlyShown(before.tabs, s.tabs)) void reloadPane(id);
      // Other panes on screen: the sizes the user dragged no longer fit, arrange evenly again.
      if (T.shownChanged(before.tabs, s.tabs) && (s.paneWidths || s.paneRowSplit !== null)) {
        setState({ paneWidths: null, paneRowSplit: null });
      }
    }
    if (s.tabs !== before.tabs || s.panes !== before.panes) syncWatches();
    if (s.tabs !== before.tabs || s.mru !== before.mru) saveSessionSoon();
  });
}
