// Changes to the tabs and to a pane's view settings. Spec: docs/spec/tabs.md

import { NO_MODS, type Mods } from "../model/navigation";
import { addToMru } from "../model/session";
import * as T from "../model/tabs";
import { rememberView } from "./folderViews";
import { forgetPane, reloadPane } from "./loading";
import { setMessage } from "./message";
import { openExternal } from "./navigation";
import { getState, setState, updatePane, type PaneState } from "./store";

export function closeTabs(ids: string[]) {
  const st = getState();
  const { state, closed } = T.closeTabs(st.tabs, ids, st.options.LockClose);
  if (!closed.length) return;
  const panes = { ...st.panes };
  for (const t of closed) {
    const p = panes[t.id];
    if (p?.folder) rememberView(p.folder.location, p.view);
    delete panes[t.id];
    forgetPane(t.id);
  }
  setState((s) => ({ tabs: state, panes, mru: addToMru(s.mru, closed.map((t) => t.location)) }));
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
