// What the window's frame draws: which bars, the menu bar, the open popup and dialog, the frame
// around a drop target.

import type { MenuItem } from "../config/types";
import { menuBarIndex, type PopupRequest } from "../state/popup";
import type { Dialog, Frame } from "../state/store";
import { itemLabel, type ItemLabel } from "./items";
import { presenter } from "./view";

export interface AppVM {
  menuBar: boolean;
  toolBar: boolean;
  linkBar: boolean;
  statusBar: boolean;
  /** Text size in px; every text height follows it (base.css). */
  fontSize: number;
}

export const appView = presenter(
  (s) => {
    const o = s.app.options;
    return [o.MenuVisible, o.ToolVisible, o.LinkVisible, o.StatusVisible, o.FontSize] as const;
  },
  (menuBar, toolBar, linkBar, statusBar, fontSize): AppVM => ({ menuBar, toolBar, linkBar, statusBar, fontSize }),
);

export interface MenuBarVM {
  items: ItemLabel[];
  /** Index of the item whose menu is open, or -1. */
  open: number;
  /** Index of the item highlighted for the keyboard (after Alt alone), or -1. */
  hot: number;
}

/** Index of the menu bar item that owns the popup, or -1. */
export function openBarItem(popup: Pick<PopupRequest, "owner"> | null): number {
  return menuBarIndex(popup?.owner);
}

export const menuBarView = presenter(
  (s) => [s.config.menu, openBarItem(s.app.popup), s.app.menuBarHot] as const,
  (menu: MenuItem[], open, hot): MenuBarVM => ({ items: menu.map(itemLabel), open, hot: hot ?? -1 }),
);

/** The open popup menu as it was asked for, or null. */
export const popupView = presenter(
  (s) => [s.app.popup] as const,
  (popup): PopupRequest | null => popup,
);

export type DialogVM =
  | { kind: "about"; title: string; version: string }
  | {
      kind: "text";
      title: string;
      label: string;
      initial: string;
      /** Characters selected at first; undefined selects everything. */
      selectLength?: number;
      /** Earlier inputs to pick from, newest first. */
      history: string[];
    };

const TEXT_DIALOGS: Record<Exclude<Dialog["kind"], "about">, { title: string; label: string }> = {
  location: { title: "開く", label: "開く場所:" },
  goLocation: { title: "場所を指定", label: "移動する場所:" },
  newFile: { title: "新規作成", label: "名前（拡張子がなければフォルダ）:" },
  pattern: { title: "パターンを指定して選択", label: "パターン (; 区切り):" },
};

export const dialogView = presenter(
  (s) => [s.app.dialog, s.app.appVersion] as const,
  (dialog, version): DialogVM | null => {
    if (!dialog) return null;
    if (dialog.kind === "about") return { kind: "about", title: "バージョン情報", version };
    const initial = dialog.initial ?? "";
    // A new file's name is selected without its extension, ready to be typed over.
    const dot = dialog.kind === "newFile" ? initial.lastIndexOf(".") : -1;
    return {
      kind: "text",
      ...TEXT_DIALOGS[dialog.kind],
      initial,
      selectLength: dot > 0 ? dot : undefined,
      history: dialog.history ?? [],
    };
  },
);

/** The frame around what a drag is over, or null. */
export const dropFrameView = presenter(
  (s) => [s.app.dropFrame] as const,
  (frame): Frame | null => frame,
);
