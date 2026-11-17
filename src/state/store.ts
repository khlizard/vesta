// Application state (zustand). Flows that call the backend live in ./actions.ts.

import { create } from "zustand";
import type { DiskFree, Entry, FolderInfo } from "../api/types";
import { DEFAULT_COLUMNS } from "../model/columns";
import { OPEN_GATE, type Gate } from "../model/gate";
import { modeOf, type Mode } from "../model/mode";
import type { PopupRequest } from "./popup";
import type { SortKey } from "../model/sort";
import { EMPTY_TABS, type InsertPosition, type TabsState } from "../model/tabs";

export type ViewMode = "details" | "thumbnail";

/** Per-folder view settings (docs/spec/listing.md「フォルダごとの表示設定」). */
export interface ViewSettings {
  mode: ViewMode;
  sortKey: SortKey;
  sortDesc: boolean;
  grouping: boolean;
  showHidden: boolean;
}

export const DEFAULT_WIDTHS: Record<SortKey, number> = {
  name: 220,
  status: 48,
  modified: 130,
  type: 140,
  size: 90,
  created: 130,
  accessed: 130,
  attributes: 60,
};

export const DEFAULT_VIEW: ViewSettings = {
  mode: "details",
  sortKey: "name",
  sortDesc: false,
  grouping: false,
  showHidden: false,
};

export interface PaneState {
  folder: FolderInfo | null;
  entries: Entry[];
  loading: boolean;
  error: string | null;
  /** Selected item locations. */
  selected: Set<string>;
  /** Keyboard cursor (item location). */
  cursor: string | null;
  /** Anchor for Shift range selection. */
  anchor: string | null;
  view: ViewSettings;
  /** Item being renamed in place. */
  renaming: string | null;
  disk: DiskFree | null;
}

export function emptyPane(view: ViewSettings = DEFAULT_VIEW): PaneState {
  return {
    folder: null,
    entries: [],
    loading: false,
    error: null,
    selected: new Set(),
    cursor: null,
    anchor: null,
    view,
    renaming: null,
    disk: null,
  };
}

/** Options (docs/spec/config.md「config.json のオプション」). Names follow Avesta. */
export interface Options {
  DistinguishTab: boolean;
  RestoreCond: boolean;
  RenameExtension: boolean;
  FullRowSelect: boolean;
  GridLine: boolean;
  OpenDups: boolean;
  LockClose: boolean;
  PasteInFolder: boolean;
  DnDCopyInterDrv: boolean;
  Insert: InsertPosition;
  ThumbnailSize: number;
  /** Text size in px (Vesta only; docs/spec/ui.md「見た目」). */
  FontSize: number;
  /** Details columns, shown in this order (Vesta only; docs/spec/listing.md「列のカスタマイズ」). */
  Columns: SortKey[];
  /** Details column widths (px), shared by all folders and panes (Vesta only). */
  ColumnWidths: Record<SortKey, number>;
  /** Arrange many panes in two rows (Vesta only, experimental; docs/spec/tabs.md「2段に並べる」). */
  TwoRows: boolean;
  /** Panes per row before the second row starts. */
  TwoRowsMax: number;
  MenuVisible: boolean;
  ToolVisible: boolean;
  LinkVisible: boolean;
  StatusVisible: boolean;
}

export const DEFAULT_OPTIONS: Options = {
  DistinguishTab: true,
  RestoreCond: true,
  RenameExtension: true,
  FullRowSelect: false,
  GridLine: false,
  OpenDups: false,
  LockClose: true,
  PasteInFolder: false,
  DnDCopyInterDrv: true,
  Insert: "tail",
  ThumbnailSize: 96,
  FontSize: 12,
  Columns: [...DEFAULT_COLUMNS],
  ColumnWidths: DEFAULT_WIDTHS,
  TwoRows: false,
  TwoRowsMax: 6,
  MenuVisible: true,
  ToolVisible: true,
  LinkVisible: true,
  StatusVisible: true,
};

export type DialogKind = "location" | "goLocation" | "newFile" | "pattern" | "about";

export interface Dialog {
  kind: DialogKind;
  initial?: string;
  /** Earlier inputs to pick from (File.Open), newest first. */
  history?: string[];
}

export interface AppState {
  tabs: TabsState;
  panes: Record<string, PaneState>;
  options: Options;
  /** Recently closed folders, newest first (max 10). */
  mru: string[];
  /** Transient status bar message (overrides the pane text until cleared). */
  message: string | null;
  /** Pane widths as fractions, keyed by tab id; reset whenever the layout changes. */
  paneWidths: Record<string, number> | null;
  /** Height of the upper row as a fraction, when the panes are in two rows; reset with paneWidths. */
  paneRowSplit: number | null;
  dialog: Dialog | null;
  /** Version of a downloaded update waiting to be applied (docs/spec/update.md). */
  updateReady: string | null;

  // What the mode is read from (model/mode.ts, docs/spec/ui.md「モード」), with `dialog` above
  // and each pane's `renaming`.
  /** The open popup menu (menu bar, bars, context menus). */
  popup: PopupRequest | null;
  /** Menu bar item highlighted for keyboard use (after Alt alone). */
  menuBarHot: number | null;
  /** The pane whose address bar is being typed in. */
  addressEditing: string | null;
  /** A Shell context menu or a drag started here has the input. */
  native: boolean;
  /** Folder names offered for the path being typed in the address bar of `paneId`. */
  suggest: { paneId: string; parent: string; names: string[] } | null;
  /** Version of the app, for the About dialog. */
  appVersion: string;

  /** Where the keyboard focus should go; a view that is the target takes it when `seq` changes. */
  focus: FocusRequest | null;
  /** File operations run one at a time (model/gate.ts). */
  gate: Gate;
  /** Frame around what a drag is over, in client px. */
  dropFrame: Frame | null;
  /** Where the link bar items point, by their `path`; null: not found. Missing: not looked up yet. */
  linkTargets: Record<string, LinkTarget | null>;
  /** Sizes the views report, for the decisions that need them. */
  layout: {
    /** Left and bottom edge of each menu bar item: where its menu opens. */
    menuBar: { x: number; y: number }[];
    /** Client width of each pane's list (px). */
    listWidths: Record<string, number>;
  };
}

/** Where a link bar item points. */
export interface LinkTarget {
  location: string;
  isFolder: boolean;
  /** Location of the containing folder (for the Shell context menu). */
  parent: string;
}

export interface FocusRequest {
  paneId: string;
  target: "list" | "address";
  seq: number;
}

export interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const useStore = create<AppState>(() => ({
  tabs: EMPTY_TABS,
  panes: {},
  options: DEFAULT_OPTIONS,
  mru: [],
  message: null,
  paneWidths: null,
  paneRowSplit: null,
  dialog: null,
  updateReady: null,
  popup: null,
  menuBarHot: null,
  addressEditing: null,
  native: false,
  suggest: null,
  appVersion: "",
  focus: null,
  gate: OPEN_GATE,
  dropFrame: null,
  linkTargets: {},
  layout: { menuBar: [], listWidths: {} },
}));

export const getState = useStore.getState;
export const setState = useStore.setState;

export function updatePane(id: string, f: (p: PaneState) => Partial<PaneState>) {
  setState((s) => {
    const p = s.panes[id];
    if (!p) return s;
    return { panes: { ...s.panes, [id]: { ...p, ...f(p) } } };
  });
}

/** The pane with an item being renamed in place, if any. */
function renamingPane(s: AppState): string | null {
  for (const id in s.panes) if (s.panes[id].renaming) return id;
  return null;
}

/** The mode the window is in (docs/spec/ui.md「モード」). */
export function modeIn(s: AppState): Mode {
  const renaming = renamingPane(s);
  return modeOf({
    dialog: s.dialog !== null,
    popupOwner: s.popup ? (s.popup.owner ?? "") : null,
    native: s.native,
    editing: renaming
      ? { paneId: renaming, field: "rename" }
      : s.addressEditing
        ? { paneId: s.addressEditing, field: "address" }
        : null,
    menuBarHot: s.menuBarHot !== null,
  });
}

/** Id of the current tab, which is also the id of its pane. */
export function currentPaneId(): string | null {
  return getState().tabs.currentId;
}

/** The pane of the current tab. */
export function currentPane(): PaneState | null {
  const s = getState();
  return (s.tabs.currentId && s.panes[s.tabs.currentId]) || null;
}
