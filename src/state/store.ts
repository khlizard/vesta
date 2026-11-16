// Application state (zustand). Flows that call the backend live in ./actions.ts.

import { create } from "zustand";
import type { DiskFree, Entry, FolderInfo } from "../api/types";
import { DEFAULT_COLUMNS } from "../model/columns";
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
  MenuVisible: true,
  ToolVisible: true,
  LinkVisible: true,
  StatusVisible: true,
};

export type DialogKind = "location" | "goLocation" | "newFile" | "pattern" | "about";

export interface Dialog {
  kind: DialogKind;
  initial?: string;
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
  dialog: Dialog | null;
  /** Version of a downloaded update waiting to be applied (docs/spec/update.md). */
  updateReady: string | null;
}

export const useStore = create<AppState>(() => ({
  tabs: EMPTY_TABS,
  panes: {},
  options: DEFAULT_OPTIONS,
  mru: [],
  message: null,
  paneWidths: null,
  dialog: null,
  updateReady: null,
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

export function currentPaneId(): string | null {
  return getState().tabs.currentId;
}
