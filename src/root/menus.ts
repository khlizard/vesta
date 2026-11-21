// The menus the root opens: the menu bar, a tab, the columns, the folders above a pane.

import { backend } from "../api/backend";
import { iconUrl } from "../api/urls";
import { runItem } from "../commands/items";
import { useConfig } from "../config/store";
import { ALL_COLUMNS, columnMenuLabel, DEFAULT_COLUMNS, toggleColumn } from "../model/columns";
import { menuLabel } from "../model/menu";
import { NO_MODS, type Mods } from "../model/navigation";
import * as T from "../model/tabs";
import { navigate } from "../state/navigation";
import { setOption } from "../state/options";
import { closePopup, MENU_OWNER, menuBarIndex, openPopup, popupOwner, type PopupItem } from "../state/popup";
import { getState, setState } from "../state/store";
import { closeTabs, setTabs } from "../state/tabActions";
import { attempt } from "./run";

// ---------------------------------------------------------------- menus

export function openMenuBar(index: number, byKey: boolean) {
  const item = useConfig.getState().menu[index];
  if (!item) return;
  const at = getState().layout.menuBar[index];
  if (item.children?.length && at) {
    openPopup(item.children, at.x, at.y, `${MENU_OWNER}${index}`, !byKey);
  } else {
    closePopup();
    setState({ menuBarHot: null });
    attempt(runItem(item, NO_MODS));
  }
}

/** Index of the menu bar item whose menu is open, or -1. */
export function openBarIndex(): number {
  return menuBarIndex(popupOwner());
}

export const barAccessKeys = () => useConfig.getState().menu.map((m) => menuLabel(m.text).accessKey);

export function tabMenuItems(id: string): PopupItem[] {
  return T.tabMenu(getState().tabs, id).map((entry): PopupItem => {
    if (!entry) return { separator: true };
    return {
      text: entry.text,
      checked: entry.checked,
      disabled: entry.disabled,
      onSelect: () => {
        const { state, close } = T.applyTabMenu(getState().tabs, id, entry.action);
        setTabs(() => state);
        if (close.length) closeTabs(close);
      },
    };
  });
}

/** Header context menu: show/hide columns (docs/spec/listing.md「列のカスタマイズ」). */
export function columnMenuItems(): PopupItem[] {
  const columns = getState().options.Columns;
  const items: PopupItem[] = ALL_COLUMNS.map((key) => ({
    text: columnMenuLabel(key),
    checked: columns.includes(key),
    disabled: key === "name",
    onSelect: () => attempt(setOption("Columns", toggleColumn(getState().options.Columns, key))),
  }));
  items.push(
    { separator: true },
    { text: "既定に戻す(_D)", onSelect: () => attempt(setOption("Columns", [...DEFAULT_COLUMNS])) },
  );
  return items;
}

/** The folders above the one pane `id` shows, down from the desktop, as a menu to go to. */
export async function ancestorItems(id: string): Promise<PopupItem[]> {
  const folder = getState().panes[id]?.folder;
  if (!folder) return [];
  const ancestors = await backend.folderAncestors(folder.location);
  return ancestors.map((f, i) => ({
    text: f.displayName,
    literal: true,
    iconSrc: iconUrl(f.location),
    indent: i,
    strong: i === ancestors.length - 1,
    onSelect: (mods: Mods) => attempt(navigate(id, f.location, mods)),
  }));
}
