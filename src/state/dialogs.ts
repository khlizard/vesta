// Opening and closing the modal dialogs. Spec: docs/spec/ui.md「モード」

import { focusPane } from "./focus";
import { getState, setState, type DialogKind } from "./store";

const HISTORY_MAX = 20;

/** Inputs given to File.Open during this session, newest first. */
let locationHistory: string[] = [];

/** Notes an input of File.Open, to offer it again the next time. */
export function rememberLocation(text: string) {
  locationHistory = [text, ...locationHistory.filter((h) => h !== text)].slice(0, HISTORY_MAX);
}

/** Opens a dialog. The menu bar highlight and any popup give way to it. */
export function openDialog(kind: DialogKind, initial?: string) {
  const history = kind === "location" ? locationHistory : undefined;
  setState({ dialog: { kind, initial, history }, popup: null, menuBarHot: null });
}

/** Closes the dialog. The focus, which its field had, goes back to the current pane. */
export function closeDialog() {
  if (!getState().dialog) return;
  setState({ dialog: null });
  focusPane();
}
