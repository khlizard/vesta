// Flows that combine the tab model, pane state and backend calls.
// Specs: docs/spec/tabs.md, navigation.md, listing.md

import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { backend } from "../api/backend";
import type { Entry, FolderInfo, WindowPlacement } from "../api/types";
import { errorText } from "../model/input";
import { externalAction, inPaneAction, NO_MODS, type Action, type Mods } from "../model/navigation";
import { oneAtATime, saveLater, within } from "../model/pacing";
import { sameLocation, uniqueByLocation } from "../model/paths";
import { buildSession, parseSession } from "../model/session";
import * as T from "../model/tabs";
import { mayClose } from "./busy";
import { getViewFor, loadViews, rememberView, saveViews } from "./folderViews";
import { saveOptions } from "./options";
import { emptyPane, getState, setState, updatePane, useStore, type PaneState } from "./store";

let seq = 0;
const newId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

let messageTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows a transient message in the status bar. */
export function setMessage(text: string | null, ms = 5000) {
  clearTimeout(messageTimer);
  setState({ message: text });
  if (text) messageTimer = setTimeout(() => setState({ message: null }), ms);
}

// ---------------------------------------------------------------- loading

/**
 * Lists `location` into pane `tabId`. Returns the folder on success, null on failure.
 * A failed move to another folder leaves the pane where it was, with the error in the status
 * bar. When the folder the pane already shows (or a tab that never loaded) cannot be read, the
 * pane is emptied and shows the error itself: a list of what used to be there would be wrong.
 */
async function loadInto(
  tabId: string,
  location: string,
  opts: { select?: string | null; keepSelection?: boolean } = {},
): Promise<FolderInfo | null> {
  const pane = getState().panes[tabId];
  if (!pane) return null;
  const view = pane.folder && sameLocation(pane.folder.location, location) ? pane.view : getViewFor(location);
  // A reload re-lists the folder the pane already shows; anything else is a move to another folder.
  const isReload = !!pane.folder && sameLocation(pane.folder.location, location);
  const token = isReload ? (moveSeq.get(tabId) ?? 0) : bumpMove(tabId);
  /** A newer move started, or (for a reload) the pane left this folder: drop this result. */
  const stale = () => {
    if ((moveSeq.get(tabId) ?? 0) !== token) return true;
    const now = getState().panes[tabId];
    return !now || (isReload && !(now.folder && sameLocation(now.folder.location, location)));
  };
  updatePane(tabId, () => ({ loading: true }));
  try {
    const listing = await backend.listFolder(location, view.showHidden);
    if (stale()) return null;
    const entries = uniqueByLocation(listing.entries);
    const locs = new Set(entries.map((e) => e.location));
    updatePane(tabId, (p) => {
      // `select` (when listed) becomes the only selected item; otherwise keep what is still there.
      const select = opts.select && locs.has(opts.select) ? opts.select : null;
      const kept = select
        ? new Set([select])
        : opts.keepSelection
          ? new Set([...p.selected].filter((l) => locs.has(l)))
          : new Set<string>();
      const cursor = select ?? (opts.keepSelection && p.cursor && locs.has(p.cursor) ? p.cursor : null);
      return {
        folder: listing.folder,
        entries,
        loading: false,
        error: null,
        selected: kept,
        cursor,
        anchor: cursor,
        view,
        // A reload (e.g. from the folder watcher) must not cancel an in-place rename.
        renaming: opts.keepSelection && p.renaming && locs.has(p.renaming) ? p.renaming : null,
      };
    });
    void backend
      .diskFree(listing.folder.location)
      .then((disk) => updatePane(tabId, () => ({ disk })))
      .catch(() => updatePane(tabId, () => ({ disk: null })));
    return listing.folder;
  } catch (e) {
    if (stale()) return null;
    if (isReload || !pane.folder) {
      updatePane(tabId, () => ({
        loading: false,
        error: errorText(e),
        entries: [],
        selected: new Set<string>(),
        cursor: null,
        anchor: null,
        renaming: null,
        disk: null,
      }));
    } else {
      updatePane(tabId, () => ({ loading: false }));
      setMessage(`${location}: ${errorText(e)}`);
    }
    return null;
  }
}

/** Per pane: counts moves to another folder, so a slow listing cannot overwrite a newer one. */
const moveSeq = new Map<string, number>();
function bumpMove(tabId: string): number {
  const n = (moveSeq.get(tabId) ?? 0) + 1;
  moveSeq.set(tabId, n);
  return n;
}

/**
 * Re-lists the pane's folder keeping the selection; `select` (if listed) becomes selected and the cursor.
 * A pane that never loaded (a restored tab whose folder was unreachable) tries its tab's location again.
 * Reloads asked for while one is running are folded into one more after it.
 */
export const reloadPane: (tabId: string, select?: string) => Promise<void> = oneAtATime(reloadNow);

/** Current.Refresh: reads the pane again and renews the folder watches (one may have stopped unnoticed). */
export async function refreshPane(tabId: string) {
  syncWatches(true);
  await reloadPane(tabId);
}

async function reloadNow(tabId: string, select?: string): Promise<void> {
  const p = getState().panes[tabId];
  if (!p) return;
  if (p.folder) {
    await loadInto(tabId, p.folder.location, { keepSelection: true, select });
    return;
  }
  const tab = getState().tabs.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const folder = await loadInto(tabId, tab.location);
  if (folder) {
    const info = { location: folder.location, displayName: folder.displayName, fsPath: folder.fsPath };
    setState((s) => ({ tabs: T.renameTab(s.tabs, tabId, info) }));
  }
}

// ---------------------------------------------------------------- opening

function makeTab(folder: Pick<FolderInfo, "location" | "displayName" | "fsPath">): T.Tab {
  return {
    id: newId(),
    location: folder.location,
    displayName: folder.displayName,
    fsPath: folder.fsPath,
    shown: false,
    locked: false,
    back: [],
    forward: [],
  };
}

/** Applies a new-tab action for an already-open tab (OpenDups off). */
function reuseTab(s: T.TabsState, id: string, action: Action): T.TabsState {
  switch (action) {
    case "open":
      return T.clickTab(s, id);
    case "append":
      return T.setShown(s, [id], true);
    case "switch":
    case "replace":
      return T.focusTab(s, id);
    default:
      return s;
  }
}

/** Opens `folder` in a new tab (or an existing one) according to `action`. */
async function openInTab(folder: FolderInfo, action: Action) {
  const st = getState();
  if (!st.options.OpenDups) {
    const existing = st.tabs.tabs.find((t) => sameLocation(t.location, folder.location));
    if (existing) {
      setState({ tabs: reuseTab(st.tabs, existing.id, action) });
      return existing.id;
    }
  }
  const tab = makeTab(folder);
  setState((s) => ({
    tabs: T.addTab(s.tabs, tab, action, s.options.Insert),
    panes: { ...s.panes, [tab.id]: emptyPane(getViewFor(folder.location)) },
  }));
  await loadInto(tab.id, folder.location);
  return tab.id;
}

/**
 * Opens what the user typed or a settings file names: a file is run, a folder is opened. With
 * `paneId` the folder opens from that pane (address bar, Current.Go.Location); without, from
 * outside every pane (link bar, File.Open, MRU, command line). False when it could not be opened;
 * the reason is then in the status bar.
 */
export async function openInput(input: string, mods: Mods = NO_MODS, paneId?: string | null): Promise<boolean> {
  try {
    const r = await backend.resolveLocation(input);
    if (r.kind === "file") await backend.openItems([r.location]);
    else if (paneId) await navigate(paneId, r.folder.location, mods, "goto", r.folder);
    else await openInTab(r.folder, externalAction(mods));
    return true;
  } catch (e) {
    setMessage(`${input}: ${errorText(e)}`);
    return false;
  }
}

/** Opens user input from outside a pane. */
export async function openExternal(input: string, mods: Mods = NO_MODS) {
  await openInput(input, mods);
}

/**
 * Opens the folders among `paths` (dropped on a bar, outside every pane and tab). Anything that
 * is not a folder is ignored without a message.
 */
export async function openDroppedFolders(paths: string[], mods: Mods = NO_MODS) {
  for (const p of paths) {
    try {
      const r = await backend.resolveLocation(p);
      if (r.kind === "folder") await openInTab(r.folder, externalAction(mods));
    } catch {
      // Not something that can be opened: ignored, like files.
    }
  }
}

type NavKind = "goto" | "back" | "forward" | "up";

/**
 * Moves pane `tabId` to `location` following the in-pane action table. `known` is the folder at
 * `location` when the caller has already resolved it.
 */
export async function navigate(
  tabId: string,
  location: string,
  mods: Mods = NO_MODS,
  kind: NavKind = "goto",
  known?: FolderInfo,
) {
  const tab = getState().tabs.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const action = inPaneAction(mods, tab.locked);
  if (action === "goto" || action === "gotoAlways") {
    if (kind === "goto" && sameLocation(tab.location, location)) return;
    const prev = tab.location;
    const folder = await loadInto(tabId, location, { select: kind === "up" ? prev : null });
    if (!folder) return;
    const info = { location: folder.location, displayName: folder.displayName, fsPath: folder.fsPath };
    setState((s) => ({
      tabs:
        kind === "back" || kind === "forward"
          ? T.applyHistory(s.tabs, tabId, kind, info)
          : T.navigateTab(s.tabs, tabId, info),
    }));
    return;
  }
  try {
    if (known) {
      await openInTab(known, action);
      return;
    }
    const r = await backend.resolveLocation(location);
    if (r.kind === "folder") await openInTab(r.folder, action);
  } catch (e) {
    setMessage(`${location}: ${errorText(e)}`);
  }
}

export async function goUp(tabId: string, mods: Mods = NO_MODS) {
  const parent = getState().panes[tabId]?.folder?.parent;
  if (parent) await navigate(tabId, parent, mods, "up");
}

export async function goHistory(tabId: string, dir: "back" | "forward", mods: Mods = NO_MODS) {
  const tab = getState().tabs.tabs.find((t) => t.id === tabId);
  const target = tab && T.historyTarget(tab, dir);
  if (target) await navigate(tabId, target, mods, dir);
}

/** Double-click / Enter on items. */
export async function openEntries(tabId: string, entries: Entry[], mods: Mods = NO_MODS) {
  // A shortcut to a folder opens like that folder (in a tab), not in Explorer.
  const targets = new Map<string, string>();
  await Promise.all(
    entries
      .filter((e) => !e.isFolder && e.isLink)
      .map(async (e) => {
        const f = await backend.linkFolder(e.location).catch(() => null);
        if (f) targets.set(e.location, f.location);
      }),
  );
  const folders = entries.flatMap((e) => {
    const target = targets.get(e.location);
    return target ? [{ ...e, location: target }] : e.isFolder ? [e] : [];
  });
  const files = entries.filter((e) => !e.isFolder && !targets.has(e.location));
  if (files.length) {
    try {
      await backend.openItems(files.map((f) => f.location));
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  if (folders.length === 1) {
    await navigate(tabId, folders[0].location, mods);
  } else {
    for (const f of folders) {
      const r = await backend.resolveLocation(f.location).catch(() => null);
      if (r?.kind === "folder") await openInTab(r.folder, "append");
    }
  }
}

// ---------------------------------------------------------------- tabs

function pushMru(locations: string[]) {
  setState((s) => {
    let mru = s.mru;
    for (const l of locations) mru = [l, ...mru.filter((m) => !sameLocation(m, l))];
    return { mru: mru.slice(0, 10) };
  });
}

export function closeTabs(ids: string[]) {
  const st = getState();
  const { state, closed } = T.closeTabs(st.tabs, ids, st.options.LockClose);
  if (!closed.length) return;
  pushMru(closed.map((t) => t.location));
  const panes = { ...st.panes };
  for (const t of closed) {
    const p = panes[t.id];
    if (p?.folder) rememberView(p.folder.location, p.view);
    delete panes[t.id];
    moveSeq.delete(t.id);
  }
  setState({ tabs: state, panes });
}

export function closeTarget(target: T.CloseTarget) {
  closeTabs(T.targetIds(getState().tabs, target));
}

/** `File.MRU`: reopens the most recently closed folder. */
export async function reopenClosed(mods: Mods = NO_MODS) {
  const [first, ...rest] = getState().mru;
  if (!first) {
    setMessage("最近閉じたフォルダはありません");
    return;
  }
  setState({ mru: rest });
  await openExternal(first, mods);
}

export function setTabs(f: (s: T.TabsState) => T.TabsState) {
  setState((s) => ({ tabs: f(s.tabs) }));
}

export function setView(tabId: string, f: (v: PaneState["view"]) => Partial<PaneState["view"]>, reload = false) {
  updatePane(tabId, (p) => {
    const view = { ...p.view, ...f(p.view) };
    if (p.folder) rememberView(p.folder.location, view);
    return { view };
  });
  if (reload) void reloadPane(tabId);
}

// ---------------------------------------------------------------- watching & session

let watched = "";

/** Where pane `id` is, or is meant to be (a tab whose folder never loaded). */
function paneLocation(s: ReturnType<typeof getState>, id: string): string | null {
  return s.panes[id]?.folder?.location ?? s.tabs.tabs.find((t) => t.id === id)?.location ?? null;
}

/** Asks the backend to watch the folders of the shown panes. `fresh` renews watches that exist. */
function syncWatches(fresh = false) {
  const s = getState();
  const locs = [
    ...new Set(T.shownTabs(s.tabs).map((t) => paneLocation(s, t.id)).filter((l): l is string => !!l)),
  ].sort();
  const key = locs.join("|");
  if (key === watched && !fresh) return;
  watched = key;
  void backend.watchFolders(locs, fresh).catch(() => {});
}

/** The last known place of the window: from session.json at startup, then from each save. */
let lastWindow: WindowPlacement | null = null;

/**
 * False until startup has put the tabs back. Until then session.json must not be written:
 * the store still has no tabs, and writing would lose the saved ones.
 */
let sessionReady = false;

/** session.json: the tabs, the closed folders and where the window is. */
const session = saveLater(1000, async () => {
  if (!sessionReady) return;
  lastWindow = (await backend.windowPlacement().catch(() => null)) ?? lastWindow;
  const s = getState();
  await backend.writeState("session", JSON.stringify(buildSession(s.tabs, s.mru, lastWindow))).catch(() => {});
});

const FLUSH_LIMIT_MS = 2000;

/** Writes everything that is waiting to be saved (before the window closes or the app restarts). */
export async function flushState() {
  const all = Promise.all([session.now(), saveOptions(), saveViews()]).catch(() => {});
  // A stuck write must not keep the window from closing.
  await Promise.race([all, new Promise((done) => setTimeout(done, FLUSH_LIMIT_MS))]);
}

/** Tab label and path for a saved location that did not resolve. */
function placeholderFolder(location: string): Pick<FolderInfo, "location" | "displayName" | "fsPath"> {
  const name = location.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return { location, displayName: name || location, fsPath: /^([A-Za-z]:|\\\\)/.test(location) ? location : null };
}

const RESOLVE_LIMIT_MS = 3000;

async function restoreSession(): Promise<boolean> {
  const raw = await backend.readState("session").catch(() => null);
  if (!raw) return false;
  const session = parseSession(raw);
  if (!session) return false;
  lastWindow = session.window ?? null;
  setState({ mru: session.mru });
  if (!getState().options.RestoreCond || !session.tabs.length) return false;
  const tabs: T.Tab[] = [];
  const panes: Record<string, PaneState> = {};
  // A place that does not answer (a server that is off) must not hold the other tabs back:
  // after RESOLVE_LIMIT_MS its tab is made without it, like one that failed.
  const resolved = await Promise.all(
    session.tabs.map((t) => within(backend.resolveLocation(t.location).catch(() => null), RESOLVE_LIMIT_MS, null)),
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
      console.warn(`startup: ${what}`, e);
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
  sessionReady = true;
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
  await win.onMoved(session.soon).catch(() => {});
  await win.onResized(session.soon).catch(() => {});
  // The window is destroyed after this handler returns, unless the close is cancelled.
  await win
    .onCloseRequested(async (event) => {
      if (!mayClose()) {
        event.preventDefault();
        return;
      }
      await flushState();
    })
    .catch(() => {});
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
    if (s.tabs !== before.tabs || s.mru !== before.mru) session.soon();
  });
}
