// What the status bar draws: the pane's text on the left, the status.xml buttons on the right.
// Spec: docs/spec/listing.md

import type { MenuItem } from "../config/types";
import { statusText } from "../model/format";
import { isSeparator } from "../state/popup";
import { selectedEntries } from "../state/selection";
import type { PaneState } from "../state/store";
import { itemState } from "./items";
import { presenter, sameFields } from "./view";

export type StatusEntry =
  | { kind: "separator" }
  | {
      kind: "button";
      /** What a click sends. */
      item: MenuItem;
      title: string | undefined;
      enabled: boolean;
      checked: boolean;
      /** The icon on the button; null: its text stands there instead. */
      image: number | null;
      text: string;
    };

export interface StatusBarView {
  text: string;
  /** The button that applies a downloaded update; null while there is none. */
  update: { item: MenuItem; label: string; title: string } | null;
  buttons: StatusEntry[];
}

const UPDATE_ITEM: MenuItem = { command: "System.Update" };
const UPDATE_TITLE = "クリックすると、更新して再起動します。このまま使い続けても、終了したときに更新します";

/** The text on the left: a message while there is one, else the counts of the current pane. */
function leftText(message: string | null, pane: PaneState | null): string {
  if (message !== null) return message;
  if (!pane) return "";
  return statusText({
    total: pane.entries.length,
    totalBytes: pane.entries.reduce((n, e) => n + (e.size ?? 0), 0),
    selected: pane.selected.size,
    selectedBytes: selectedEntries(pane).reduce((n, e) => n + (e.size ?? 0), 0),
    disk: pane.disk,
  });
}

// Apart from the buttons: the sizes are added up only when the pane or the message changes.
const textView = presenter(
  (s) => [s.app.message, (s.app.tabs.currentId && s.app.panes[s.app.tabs.currentId]) || null] as const,
  leftText,
);

function entry(item: MenuItem): StatusEntry {
  if (isSeparator(item)) return { kind: "separator" };
  // Status bar buttons have no drop-down: only the command says whether they can be pressed.
  const { enabled, checked } = itemState({ ...item, children: undefined });
  return {
    kind: "button",
    item,
    title: item.text,
    enabled,
    checked,
    image: item.image ?? null,
    text: item.text ?? "",
  };
}

/**
 * Whether a command can run depends on the whole state, so the buttons are worked out on
 * every change; the result is kept while nothing in it differs.
 */
export const statusBarView = presenter(
  (s) => [s.app, s.config.status, textView(s)] as const,
  (app, status, text): StatusBarView => ({
    text,
    update: app.updateReady
      ? { item: UPDATE_ITEM, label: `Vesta ${app.updateReady} に更新`, title: UPDATE_TITLE }
      : null,
    buttons: status.map(entry),
  }),
  sameFields,
);
