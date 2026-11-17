// What the tool bar (tool.xml) draws: flat buttons, split buttons and drop-downs.

import { iconUrl } from "../api/urls";
import { toolContent } from "../config/icons";
import type { MenuItem } from "../config/types";
import { isSeparator, type PopupItem } from "../state/popup";
import { itemState, itemTooltip } from "./items";
import { presenter, sameFields } from "./view";

export type ToolEntry =
  | { kind: "separator" }
  | {
      /** "button": acts on a click. "split": the same, with a drop-down beside it. "drop": only a drop-down. */
      kind: "button" | "split" | "drop";
      /** What a click on the main button sends. */
      item: MenuItem;
      title: string;
      enabled: boolean;
      checked: boolean;
      /** What stands on the button: the icon `image`, the text, or the icon for "no icon". */
      content: "icon" | "text" | "fallback";
      image: number;
      text: string;
      /** The items of the drop-down. */
      menu: PopupItem[];
    };

/** The command whose drop-down lists the folders closed last. */
const MRU = "File.MRU";

function entry(item: MenuItem, mru: string[]): ToolEntry {
  if (isSeparator(item)) return { kind: "separator" };
  const isMru = item.command === MRU;
  const hasChildren = !!item.children?.length;
  const kind = isMru || (hasChildren && !!item.command) ? "split" : hasChildren ? "drop" : "button";
  // The main button of a split button is its command alone: the drop-down does not make it usable.
  const { enabled, checked } = itemState({ ...item, children: undefined });
  return {
    kind,
    item,
    title: itemTooltip(item),
    enabled,
    checked,
    content: toolContent(item.image, item.text),
    image: item.image ?? -1,
    text: item.text ?? "",
    menu: isMru
      ? mru.map((loc) => ({ text: loc, literal: true, path: loc, iconSrc: iconUrl(loc) }))
      : (item.children ?? []),
  };
}

/**
 * The entries of the tool bar. Whether a command can run depends on the whole state, so this
 * is worked out on every change; the result is kept while nothing in it differs.
 */
export const toolBarView = presenter(
  (s) => [s.app, s.config.tool] as const,
  (app, tool): ToolEntry[] => tool.map((item) => entry(item, app.mru)),
  sameFields,
);
