// Icons for the `image` numbers of menu.xml / tool.xml / status.xml. Spec: docs/spec/config.md「image の番号」
//
// The numbers keep Avesta's order, so `image` values in Avesta's usr/*.xml still pick a fitting icon.
// The pictures are Lucide icons (ISC licence). Numbers for features Vesta does not have are left out.

import {
  AppWindow,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CircleX,
  ClipboardPaste,
  Columns3,
  Copy,
  CopyMinus,
  CopyPlus,
  Eye,
  EyeClosed,
  EyeOff,
  FilePlus,
  FolderInput,
  FolderOpen,
  FolderPlus,
  History,
  House,
  LayoutDashboard,
  LayoutGrid,
  List,
  ListX,
  Lock,
  OctagonX,
  PanelLeftClose,
  PanelRightClose,
  RefreshCw,
  Save,
  Scissors,
  Star,
  Trash,
  Trash2,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";

export const COMMAND_ICONS: Readonly<Record<number, LucideIcon>> = {
  1: Undo2, // Current.Undo
  2: History, // File.MRU
  3: Scissors, // Current.Cut
  4: Copy, // Current.Copy
  5: ClipboardPaste, // Current.Paste
  6: Trash2, // Current.Delete
  7: ArrowLeft, // Current.Go.Back
  8: ArrowRight, // Current.Go.Forward
  9: ArrowUp, // Current.Go.Up
  10: FolderInput, // move to another place (Current.MoveToOther)
  11: CopyPlus, // copy to another place (Current.CopyToOther)
  13: FolderOpen, // File.Open
  14: Save, // save
  15: FilePlus, // Current.New
  16: Eye, // Current.ShowAllFiles
  17: RefreshCw, // Current.Refresh
  18: OctagonX, // stop
  19: House, // home
  21: Star, // favourites
  24: AppWindow, // window
  25: X, // Current.Close
  26: LayoutDashboard, // view mode (a drop-down of Current.Mode.*)
  27: FolderPlus, // Current.NewFolder
  28: EyeOff, // Current.Show(false)
  29: Lock, // Current.Lock
  30: Trash, // RecycleBin.Empty
  32: LayoutGrid, // Current.Mode.Thumbnail
  36: List, // Current.Mode.Details
  40: CircleX, // All.Close
  41: PanelRightClose, // Right.Close
  42: PanelLeftClose, // Left.Close
  43: EyeClosed, // Hidden.Close
  44: ListX, // Shown.Close
  45: CopyMinus, // Duplicate.Close
  46: X, // Others.Close
  53: Columns3, // All.Show(true)
};

/** What a tool bar button shows: its icon, else its text, else a generic icon (never an empty button). */
export function toolContent(image: number | undefined, text: string | undefined): "icon" | "text" | "fallback" {
  if (image !== undefined && COMMAND_ICONS[image]) return "icon";
  return text ? "text" : "fallback";
}
