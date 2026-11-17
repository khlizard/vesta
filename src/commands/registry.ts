// Command registry. Command names follow Avesta (docs/spec/config.md, docs/spec/tabs.md).
// Menus, toolbars, the status bar and key bindings all go through `runCommand`.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { backend } from "../api/backend";
import { NO_MODS, type Mods } from "../model/navigation";
import * as T from "../model/tabs";
import * as A from "../state/actions";
import * as F from "../state/fileActions";
import * as S from "../state/selection";
import { getState, setState, type Options } from "../state/store";
import { adjustColumns } from "../state/columns";
import { setFontSize, setOption } from "../state/options";
import { restartForUpdate } from "../state/update";

export { loadOptions, setOption } from "../state/options";

export interface CommandContext {
  mods: Mods;
}

interface Parsed {
  /** Name with any `[n]` index removed and without the argument, e.g. `Tab[].Show`. */
  name: string;
  index: number | null;
  arg: string | null;
}

export function parseCommand(text: string): Parsed {
  const m = /^\s*([^()]+?)\s*(?:\((.*)\))?\s*$/.exec(text);
  const raw = m ? m[1] : text.trim();
  const arg = m && m[2] !== undefined ? m[2].trim() : null;
  const im = /\[(\d+)\]/.exec(raw);
  return { name: raw.replace(/\[\d+\]/, "[]"), index: im ? Number(im[1]) : null, arg };
}

interface CommandDef {
  run: (p: Parsed, ctx: CommandContext) => unknown;
  checked?: (p: Parsed) => boolean;
  enabled?: (p: Parsed) => boolean;
}

const cur = () => getState().tabs.currentId;
const curPane = () => {
  const id = cur();
  return id ? getState().panes[id] ?? null : null;
};
const curTab = () => T.currentTab(getState().tabs);

function showArg(arg: string | null): boolean | "toggle" {
  if (arg === "true") return true;
  if (arg === "false") return false;
  return "toggle";
}

function tabAt(index: number | null): T.Tab | null {
  return index ? getState().tabs.tabs[index - 1] ?? null : null;
}


const toggleOption = (key: keyof Options): CommandDef => ({
  run: () => setOption(key, !getState().options[key] as never),
  checked: () => Boolean(getState().options[key]),
});

const valueOption = <K extends keyof Options>(key: K, value: Options[K]): CommandDef => ({
  run: () => setOption(key, value),
  checked: () => getState().options[key] === value,
});

const fontSizeCmd = (size: number): CommandDef => ({
  run: () => setFontSize(size),
  checked: () => getState().options.FontSize === size,
});

const viewToggle = (key: "grouping" | "showHidden", reload: boolean): CommandDef => ({
  run: () => {
    const id = cur();
    if (id) A.setView(id, (v) => ({ [key]: !v[key] }), reload);
  },
  checked: () => Boolean(curPane()?.view[key]),
  enabled: () => !!cur(),
});

const mode = (m: "details" | "thumbnail"): CommandDef => ({
  run: () => {
    const id = cur();
    if (id) A.setView(id, () => ({ mode: m }));
  },
  checked: () => curPane()?.view.mode === m,
  enabled: () => !!cur(),
});

const closeCmd = (target: T.CloseTarget): CommandDef => ({
  run: () => A.closeTarget(target),
  enabled: () => T.targetIds(getState().tabs, target).length > 0,
});

const showCmd = (target: T.CloseTarget): CommandDef => ({
  run: (p) => A.setTabs((s) => T.setShown(s, T.targetIds(s, target), showArg(p.arg))),
  enabled: () => T.targetIds(getState().tabs, target).length > 0,
});

const withPane = (f: (id: string, ctx: CommandContext) => unknown): CommandDef => ({
  run: (_p, ctx) => {
    const id = cur();
    if (id) return f(id, ctx);
  },
  enabled: () => !!cur(),
});

const hasSelection = () => {
  const p = curPane();
  return !!p && p.selected.size > 0;
};

const withSelection = (f: (id: string, ctx: CommandContext) => unknown): CommandDef => ({
  ...withPane(f),
  enabled: hasSelection,
});

function focusAddressBar() {
  window.dispatchEvent(new CustomEvent("vesta:focus-address", { detail: cur() }));
}

const COMMANDS: Record<string, CommandDef> = {
  // ファイル
  "File.Open": { run: () => setState({ dialog: { kind: "location" } }) },
  "File.MRU": { run: (_p, ctx) => A.reopenClosed(ctx.mods), enabled: () => getState().mru.length > 0 },
  "Current.NewFolder": withPane((id) => F.newFolder(id)),
  "Current.New": withPane(() => setState({ dialog: { kind: "newFile", initial: "新しいテキスト ドキュメント.txt" } })),
  "Current.Close": closeCmd("current"),
  "All.Close": closeCmd("all"),
  "Left.Close": closeCmd("left"),
  "Right.Close": closeCmd("right"),
  "Shown.Close": closeCmd("shown"),
  "Hidden.Close": closeCmd("hidden"),
  "Others.Close": closeCmd("others"),
  "Duplicate.Close": closeCmd("duplicate"),
  "Current.Show": showCmd("current"),
  "All.Show": showCmd("all"),
  "Left.Show": showCmd("left"),
  "Right.Show": showCmd("right"),
  "Others.Show": showCmd("others"),
  "Tab[].Show": {
    run: (p) => {
      const t = tabAt(p.index);
      if (t) A.setTabs((s) => T.setShown(s, [t.id], showArg(p.arg)));
    },
    checked: (p) => !!tabAt(p.index)?.shown,
    enabled: (p) => !!tabAt(p.index),
  },
  "Tab[].Focus": {
    run: (p) => {
      const t = tabAt(p.index);
      if (t) A.setTabs((s) => T.focusTab(s, t.id));
    },
    enabled: (p) => !!tabAt(p.index),
  },
  "RecycleBin.Empty": { run: () => backend.openItems(["::{645FF040-5081-101B-9F08-00AA002F954E}"], "empty") },
  "System.Exit": { run: () => getCurrentWindow().close() },
  // Vesta only (docs/spec/update.md): apply the downloaded update and restart.
  "System.Update": { run: () => restartForUpdate(), enabled: () => !!getState().updateReady },

  // 編集
  "Current.Undo": { run: () => F.undo() },
  "Current.Cut": withSelection((id) => F.copyOrCut(id, true)),
  "Current.Copy": withSelection((id) => F.copyOrCut(id, false)),
  "Current.Paste": withPane((id) => F.paste(id)),
  "Current.Copy.Here": withSelection((id) => F.duplicate(id)),
  "Current.Delete": withSelection((id) => F.recycle(id)),
  "Current.Bury": withSelection((id) => F.bury(id)),
  "Current.MoveToOther": withSelection((id) => F.toOther(id, "move")),
  "Current.CopyToOther": withSelection((id) => F.toOther(id, "copy")),
  "Current.Copy.Path": withPane((id) => F.copyNames(id, "path")),
  "Current.Copy.Name": withPane((id) => F.copyNames(id, "name")),
  "Current.Copy.Base": withPane((id) => F.copyNames(id, "base")),
  "Current.Rename": withSelection((id) => F.beginRename(id)),
  "Current.Property": withPane((id) => F.properties(id)),
  "Current.SelectAll": withPane((id) => S.selectAll(id)),
  "Current.SelectNone": withPane((id) => S.selectNone(id)),
  "Current.SelectReverse": withPane((id) => S.selectReverse(id)),
  "Current.SelectPattern": withPane(() => setState({ dialog: { kind: "pattern", initial: "*" } })),

  // 移動
  "Current.Go.Back": {
    run: (_p, ctx) => {
      const id = cur();
      if (id) return A.goHistory(id, "back", ctx.mods);
    },
    enabled: () => !!curTab()?.back.length,
  },
  "Current.Go.Forward": {
    run: (_p, ctx) => {
      const id = cur();
      if (id) return A.goHistory(id, "forward", ctx.mods);
    },
    enabled: () => !!curTab()?.forward.length,
  },
  "Current.Go.Up": {
    run: (_p, ctx) => {
      const id = cur();
      if (id) return A.goUp(id, ctx.mods);
    },
    enabled: () => !!curPane()?.folder?.parent,
  },
  "Current.Go.Location": withPane(() =>
    setState({ dialog: { kind: "goLocation", initial: curPane()?.folder?.fsPath ?? curPane()?.folder?.location } }),
  ),
  "Address.Focus": withPane(() => focusAddressBar()),

  // 表示
  "Current.Mode.Details": mode("details"),
  "Current.Mode.Thumbnail": mode("thumbnail"),
  "Current.Lock": {
    run: (p) => {
      const t = curTab();
      if (t) A.setTabs((s) => T.setLock(s, t.id, showArg(p.arg) === "toggle" ? !t.locked : p.arg === "true"));
    },
    checked: () => !!curTab()?.locked,
    enabled: () => !!cur(),
  },
  "Current.ShowAllFiles": viewToggle("showHidden", true),
  "Current.Grouping": viewToggle("grouping", false),
  "Current.AdjustToItem": withPane((id) => adjustColumns([id], "item")),
  "Current.AdjustToWindow": withPane((id) => adjustColumns([id], "window")),
  "Shown.AdjustToItem": { run: () => adjustColumns(T.shownTabs(getState().tabs).map((t) => t.id), "item") },
  "Shown.AdjustToWindow": { run: () => adjustColumns(T.shownTabs(getState().tabs).map((t) => t.id), "window") },
  "Current.Refresh": withPane((id) => A.refreshPane(id)),

  // ウィンドウ
  "Menu.Show": toggleOption("MenuVisible"),
  "Tool.Show": toggleOption("ToolVisible"),
  "Link.Show": toggleOption("LinkVisible"),
  "Status.Show": toggleOption("StatusVisible"),
  "Tab.Next": { run: () => A.setTabs((s) => T.cycleCurrent(s, 1)) },
  "Tab.Prev": { run: () => A.setTabs((s) => T.cycleCurrent(s, -1)) },
  "Tab.Next2": { run: () => A.setTabs((s) => T.cycleCurrent(s, 1)) },
  "Tab.Prev2": { run: () => A.setTabs((s) => T.cycleCurrent(s, -1)) },
  "Current.ToLeft": {
    run: () => {
      const s = getState().tabs;
      const i = s.tabs.findIndex((t) => t.id === s.currentId);
      if (i > 0) A.setTabs((x) => T.moveTab(x, s.currentId!, i - 1));
    },
  },
  "Current.ToRight": {
    run: () => {
      const s = getState().tabs;
      const i = s.tabs.findIndex((t) => t.id === s.currentId);
      if (i >= 0 && i < s.tabs.length - 1) A.setTabs((x) => T.moveTab(x, s.currentId!, i + 1));
    },
  },

  // オプション
  "Option.DistinguishTab": toggleOption("DistinguishTab"),
  "Option.RestoreConditions": toggleOption("RestoreCond"),
  "Option.RenameExtension": toggleOption("RenameExtension"),
  "Option.FullRowSelect": toggleOption("FullRowSelect"),
  "Option.GridLine": toggleOption("GridLine"),
  "Option.OpenDups": toggleOption("OpenDups"),
  "Option.LockClose": toggleOption("LockClose"),
  "Option.PasteInFolder": toggleOption("PasteInFolder"),
  "Option.DnDCopyInterDrive": toggleOption("DnDCopyInterDrv"),
  "Option.Insert.Head": valueOption("Insert", "head"),
  "Option.Insert.Tail": valueOption("Insert", "tail"),
  "Option.Insert.Prev": valueOption("Insert", "prev"),
  "Option.Insert.Next": valueOption("Insert", "next"),
  "Option.Thumbnail.64": valueOption("ThumbnailSize", 64),
  "Option.Thumbnail.96": valueOption("ThumbnailSize", 96),
  "Option.Thumbnail.128": valueOption("ThumbnailSize", 128),
  "Option.Thumbnail.192": valueOption("ThumbnailSize", 192),
  "Option.Thumbnail.256": valueOption("ThumbnailSize", 256),
  "Option.FontSize.11": fontSizeCmd(11),
  "Option.FontSize.12": fontSizeCmd(12),
  "Option.FontSize.14": fontSizeCmd(14),
  "Option.FontSize.16": fontSizeCmd(16),
  "Option.TwoRows": toggleOption("TwoRows"),

  // ヘルプ
  "System.About": { run: () => setState({ dialog: { kind: "about" } }) },
};

/** Registers or replaces a command (used by modules that own UI-specific commands). */
export function defineCommand(name: string, def: CommandDef) {
  COMMANDS[name] = def;
}

/** Every command name the app has (indexed ones as `Tab[].Show`). */
export function commandNames(): string[] {
  return Object.keys(COMMANDS);
}

export function isKnownCommand(text: string): boolean {
  return text.split(";").every((c) => !!COMMANDS[parseCommand(c).name]);
}

/** Runs `text`, which may be several commands separated by `;`. Unknown commands are ignored with a warning. */
export async function runCommand(text: string, ctx: CommandContext = { mods: NO_MODS }) {
  for (const part of text.split(";")) {
    if (!part.trim()) continue;
    const p = parseCommand(part);
    const def = COMMANDS[p.name];
    if (!def) {
      console.warn(`unknown command: ${part}`);
      continue;
    }
    if (def.enabled && !def.enabled(p)) continue;
    await def.run(p, ctx);
  }
}

export function commandChecked(text: string): boolean {
  const p = parseCommand(text.split(";")[0]);
  return COMMANDS[p.name]?.checked?.(p) ?? false;
}

export function commandEnabled(text: string): boolean {
  const p = parseCommand(text.split(";")[0]);
  const def = COMMANDS[p.name];
  return !!def && (def.enabled?.(p) ?? true);
}
