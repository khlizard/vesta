// Which folders the backend watches for changes. Spec: docs/spec/listing.md「一覧の更新」

import { backend } from "../api/backend";
import { shownTabs } from "../model/tabs";
import { logLine } from "./log";
import { getState, type AppState } from "./store";

let watched = "";

/** Where pane `id` is, or is meant to be (a tab whose folder never loaded). */
export function paneLocation(s: AppState, id: string): string | null {
  return s.panes[id]?.folder?.location ?? s.tabs.tabs.find((t) => t.id === id)?.location ?? null;
}

/** Asks the backend to watch the folders of the shown panes. `fresh` renews watches that exist. */
export function syncWatches(fresh = false) {
  const s = getState();
  const locs = [
    ...new Set(
      shownTabs(s.tabs)
        .map((t) => paneLocation(s, t.id))
        .filter((l): l is string => !!l),
    ),
  ].sort();
  const key = locs.join("|");
  if (key === watched && !fresh) return;
  watched = key;
  void backend.watchFolders(locs, fresh).catch((e) => logLine("watch_folders", e));
}
