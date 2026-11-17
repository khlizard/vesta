// How a configured item (menu, tool bar, status bar) looks: its label, and whether it can be
// chosen and is ticked. Shared by every bar and menu.

import { commandChecked, commandEnabled } from "../commands/registry";
import type { MenuItem } from "../config/types";
import { labelParts, menuLabel } from "../model/menu";
import type { PopupItem } from "../state/popup";

// For the views, which do not reach into `state/` themselves.
export { accessKeyPressed, isSeparator } from "../state/popup";

/** Shown in place of the icon of a link item whose path was not found. */
export const MISSING_MARK = "×";

/** Tooltip of a link item whose path was not found. */
export function missingTitle(path: string | undefined): string {
  return `見つかりません: ${path ?? ""}`;
}

export interface ItemLabel {
  /** The label around its access key, which is drawn underlined. */
  before: string;
  key: string;
  after: string;
}

/** The label of an item: its text, else what it runs. Text marked `literal` has no access key. */
export function itemLabel(item: PopupItem): ItemLabel {
  const raw = item.text || item.execute || item.navigate || item.path || item.command || "";
  if (item.literal || !item.text) return { before: raw, key: "", after: "" };
  return labelParts(raw);
}

/** The access key of an item, in lower case. */
export function itemAccessKey(item: PopupItem): string | null {
  return item.literal ? null : menuLabel(item.text).accessKey;
}

/** The label as plain text, for a tooltip. */
export function itemTooltip(item: MenuItem): string {
  return menuLabel(item.text).label || item.command || "";
}

export const hasSubmenu = (item: PopupItem) => !!item.children?.length || !!item.loadChildren;

/**
 * Whether an item can be chosen, and whether it is ticked. What the item says itself comes
 * first; otherwise its command is asked (commands read the current state: call this while
 * presenting, never keep the answer).
 */
export function itemState(item: PopupItem): { enabled: boolean; checked: boolean } {
  const submenu = hasSubmenu(item);
  const enabled =
    item.disabled !== undefined ? !item.disabled : submenu || !item.command || commandEnabled(item.command);
  const checked = item.checked ?? (!!item.command && !submenu && commandChecked(item.command));
  return { enabled, checked };
}
