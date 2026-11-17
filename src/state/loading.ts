// Reading folders into panes. Spec: docs/spec/listing.md

import { backend } from "../api/backend";
import type { FolderInfo } from "../api/types";
import { errorText } from "../model/input";
import { oneAtATime } from "../model/pacing";
import { sameLocation, uniqueByLocation } from "../model/paths";
import * as T from "../model/tabs";
import { getViewFor } from "./folderViews";
import { setMessage } from "./message";
import { getState, setState, updatePane } from "./store";
import { syncWatches } from "./watching";

/**
 * Lists `location` into pane `tabId`. Returns the folder on success, null on failure.
 * A failed move to another folder leaves the pane where it was, with the error in the status
 * bar. When the folder the pane already shows (or a tab that never loaded) cannot be read, the
 * pane is emptied and shows the error itself: a list of what used to be there would be wrong.
 */
export async function loadInto(
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

/** Forgets what is kept about a pane that was closed. */
export function forgetPane(tabId: string) {
  moveSeq.delete(tabId);
}
