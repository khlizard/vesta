// Opening folders and moving panes. Specs: docs/spec/navigation.md, docs/spec/tabs.md

import { backend } from "../api/backend";
import type { Entry, FolderInfo } from "../api/types";
import { errorText } from "../model/input";
import { externalAction, inPaneAction, NO_MODS, type Action, type Mods } from "../model/navigation";
import { sameLocation } from "../model/paths";
import * as T from "../model/tabs";
import { getViewFor } from "./folderViews";
import { loadInto } from "./loading";
import { setMessage } from "./message";
import { emptyPane, getState, setState } from "./store";

let seq = 0;
const newId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A tab for `folder`, not yet in the tab bar. */
export function makeTab(folder: Pick<FolderInfo, "location" | "displayName" | "fsPath">): T.Tab {
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

/** Opens `folder` in a new tab (or an existing one) according to `action`. */
async function openInTab(folder: FolderInfo, action: Action) {
  const st = getState();
  if (!st.options.OpenDups) {
    const existing = st.tabs.tabs.find((t) => sameLocation(t.location, folder.location));
    if (existing) {
      setState({ tabs: T.reuseTab(st.tabs, existing.id, action) });
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

/** Tab.New: This PC in a new tab that becomes current; the shown tabs stay (docs/spec/commands.md). */
export async function openNewTab() {
  try {
    const r = await backend.resolveLocation("DRIVES");
    if (r.kind === "folder") await openInTab(r.folder, "switch");
  } catch (e) {
    setMessage(errorText(e));
  }
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
