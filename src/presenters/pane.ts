// What one pane draws around its address bar and list. Spec: docs/spec/ui.md, tabs.md

import type { ViewMode } from "../state/store";
import { presenter, type Presenter } from "./view";

export interface PaneView {
  /** False until the pane of the tab is there: nothing but an empty box is drawn. */
  exists: boolean;
  mode: ViewMode;
  current: boolean;
  loading: boolean;
  /** Why the folder could not be listed, when that is to be shown (not while it is being read again). */
  error: string | null;
}

/** The presenter of pane `id`. Make it once per id (`useMemo`): it remembers its last result. */
export function paneView(id: string): Presenter<PaneView> {
  return presenter(
    (s) => {
      const p = s.app.panes[id];
      return [p !== undefined, p?.view.mode, s.app.tabs.currentId === id, p?.loading, p?.error] as const;
    },
    (exists, mode, current, loading, error): PaneView => ({
      exists,
      mode: mode ?? "details",
      current,
      loading: !!loading,
      error: loading ? null : error || null,
    }),
  );
}
