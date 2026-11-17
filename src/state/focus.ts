// Asking for the keyboard focus. Views do not look for each other's elements: the one that is
// the target of the request in the store takes the focus itself (docs/spec/ui.md「モード」).

import { getState, setState } from "./store";

let seq = 0;

/**
 * Asks pane `paneId` (default: the current one) to take the focus, in its list or its address
 * bar. Asking again for the same place still counts: the focus may have gone elsewhere since.
 */
export function focusPane(target: "list" | "address" = "list", paneId = getState().tabs.currentId) {
  if (paneId) setState({ focus: { paneId, target, seq: ++seq } });
}
