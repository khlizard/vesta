// The root: the one place that decides what an input does. Spec: docs/spec/ui.md「モード」
//
// Views send what happened (events.ts) to `dispatch`; the window's keys and pointer presses
// arrive through `keyDown` / `keyUp` / `pointerDown` (input.ts). Each is looked at in the light
// of the mode the window is in (model/mode.ts), then carried out with the functions of
// `src/state/`. Views never call those themselves.

import { backend } from "../api/backend";
import { iconUrl } from "../api/urls";
import { runItem } from "../commands/items";
import { bindingFor } from "../commands/keys";
import { parseCommand, runCommand } from "../commands/registry";
import { useConfig } from "../config/store";
import {
  ALL_COLUMNS,
  COLUMN_LABEL,
  DEFAULT_COLUMNS,
  moveShownColumn,
  toggleColumn,
  visibleColumns,
} from "../model/columns";
import { verbCommand } from "../model/fileOps";
import { errorText, modsOf } from "../model/input";
import { barItemFor, menuBarKey, menuLabel } from "../model/menu";
import { altAloneAllowed, commandsAllowed, NO_ALT, routeKey, trackAlt, type AltPress } from "../model/mode";
import { NO_MODS, type Mods } from "../model/navigation";
import { isTyping, keyStep, openTargets, pressOnItem, typeLetter, type TypeAhead } from "../model/selection";
import type { SortKey } from "../model/sort";
import * as T from "../model/tabs";
import { stepThumbnailSize } from "../model/thumbSize";
import { createSuggester } from "../state/address";
import { fitWidth } from "../state/columns";
import { closeDialog, rememberLocation } from "../state/dialogs";
import { newItem, rename, selectedLocations } from "../state/fileActions";
import { focusPane } from "../state/focus";
import { clickLink, contextLink, hoverLink } from "../state/links";
import { setMessage } from "../state/message";
import { goHistory, goUp, navigate, openEntries, openExternal, openInput } from "../state/navigation";
import { setOption } from "../state/options";
import { closePopup, MENU_OWNER, openPopup, popupOwner, type PopupItem } from "../state/popup";
import {
  clickItem,
  jumpToPrefix,
  moveCursor,
  ordered,
  prepareContext,
  selectedEntries,
  selectPattern,
  setCursor,
  setSelection,
  toggleCursorItem,
} from "../state/selection";
import { getState, modeIn, setState, updatePane } from "../state/store";
import { closeTabs, setTabs, setView } from "../state/tabActions";
import type { Point, UiEvent } from "./events";

const mode = () => modeIn(getState());

/** Runs something that may fail, showing the reason in the status bar. */
function attempt(work: Promise<unknown>) {
  work.catch((e) => setMessage(errorText(e)));
}

// ---------------------------------------------------------------- native menus and drags

/** After a right-button drag the Shell may still send the click that would open a context menu. */
const RIGHT_DRAG_TAIL_MS = 100;

/** Marks the time a Shell menu or a drag has the input, so nothing else is started meanwhile. */
async function native<T>(work: Promise<T>, tailMs = 0): Promise<T> {
  setState({ native: true });
  try {
    return await work;
  } finally {
    if (tailMs) setTimeout(() => setState({ native: false }), tailMs);
    else setState({ native: false });
  }
}

/** The Shell context menu for `items` of `folder`; the verbs it leaves to the app run as commands. */
async function shellMenu(folder: string, items: string[], at: Point) {
  const verb = await native(backend.showContextMenu(folder, items, at.x, at.y));
  const command = verbCommand(verb, verb === "delete" && (await backend.keyState()).shift);
  if (command) await runCommand(command, { mods: NO_MODS });
}

// ---------------------------------------------------------------- menus

function openMenuBar(index: number, byKey: boolean) {
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
function openBarIndex(): number {
  const owner = popupOwner();
  return owner?.startsWith(MENU_OWNER) ? Number(owner.slice(MENU_OWNER.length)) : -1;
}

const barAccessKeys = () => useConfig.getState().menu.map((m) => menuLabel(m.text).accessKey);

function tabMenuItems(id: string): PopupItem[] {
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

const COLUMN_KEY: Record<SortKey, string> = {
  name: "N",
  status: "S",
  modified: "M",
  type: "T",
  size: "Z",
  created: "C",
  accessed: "A",
  attributes: "R",
};

/** Header context menu: show/hide columns (docs/spec/listing.md「列のカスタマイズ」). */
function columnMenuItems(): PopupItem[] {
  const columns = getState().options.Columns;
  const items: PopupItem[] = ALL_COLUMNS.map((key) => ({
    text: `${COLUMN_LABEL[key]}(_${COLUMN_KEY[key]})`,
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
async function ancestorItems(id: string): Promise<PopupItem[]> {
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

// ---------------------------------------------------------------- address bar memory

/** Per pane: what looks up folder names (it remembers the folder listed last), and the latest request. */
const suggesters = new Map<string, { suggester: ReturnType<typeof createSuggester>; seq: number }>();

async function suggestFor(id: string, text: string) {
  let entry = suggesters.get(id);
  if (!entry) suggesters.set(id, (entry = { suggester: createSuggester(), seq: 0 }));
  const seq = ++entry.seq;
  const found = await entry.suggester.suggest(text);
  // Typed on since, or the field was left: a newer answer is on its way, or none is wanted.
  if (seq !== entry.seq || getState().addressEditing !== id) return;
  setState({ suggest: found.names.length ? { paneId: id, ...found } : null });
}

function forgetSuggestions(id: string) {
  suggesters.delete(id);
  if (getState().suggest?.paneId === id) setState({ suggest: null });
}

// ---------------------------------------------------------------- list memory

/** Presses on an already selected item that wait for the button to come up (see `pressOnItem`). */
const waitingPress = new Map<string, string>();
/** Letters typed in each pane's list, for type-ahead. */
const typed = new Map<string, TypeAhead>();

/** Drops what is remembered for panes that are gone (closed tabs). */
function forgetClosedPanes() {
  const panes = getState().panes;
  for (const id of typed.keys()) if (!panes[id]) typed.delete(id);
  for (const id of waitingPress.keys()) if (!panes[id]) waitingPress.delete(id);
}

function listKey(id: string, key: string, mods: Mods, grid: { columns: number; page: number; horizontal: boolean }) {
  forgetClosedPanes();
  const p = getState().panes[id];
  if (!p) return;
  const step = keyStep(key, grid);
  if (step !== null) return moveCursor(id, step, mods);
  if (key === "Enter" && !mods.alt) {
    const sel = selectedEntries(p);
    const cur = ordered(p).entries.find((x) => x.location === p.cursor);
    const targets = sel.length ? sel : cur ? [cur] : [];
    if (targets.length) attempt(openEntries(id, targets, mods));
    return;
  }
  const now = Date.now();
  const before = typed.get(id) ?? { text: "", at: 0 };
  if (key === " " && !isTyping(before, now)) return toggleCursorItem(id);
  if (key.length === 1 && !mods.ctrl && !mods.alt) {
    const cur = ordered(p).entries.find((x) => x.location === p.cursor);
    const t = typeLetter(before, key, now, cur?.name);
    typed.set(id, t.next);
    if (t.prefix !== null) jumpToPrefix(id, t.prefix);
  }
}

/** Whether `key` is one the list acts on by itself (so the page must not also scroll or type). */
export function isListKey(
  key: string,
  mods: Mods,
  grid: { columns: number; page: number; horizontal: boolean },
): boolean {
  if (keyStep(key, grid) !== null) return true;
  if (key === "Enter") return !mods.alt;
  // Space toggles the cursor item whatever is held (Ctrl+Space after moving with Ctrl+arrows).
  if (key === " ") return true;
  return key.length === 1 && !mods.ctrl && !mods.alt;
}

// ---------------------------------------------------------------- dispatch

/** Tells the root what happened in a view. */
export function dispatch(e: UiEvent): void {
  const s = getState();
  switch (e.type) {
    // ------------------------------------------------------------ bars and menus
    case "item":
      if (commandsAllowed(mode())) attempt(runItem(e.item, e.middle ? { ...e.mods, ctrl: true } : e.mods));
      return;
    case "menu.open":
      openPopup(e.items, e.at.x, e.at.y, e.owner);
      return;
    case "menu.select":
      // The menu closes first: the item acts on what is behind it.
      closePopup();
      if (e.item.onSelect) e.item.onSelect(e.mods);
      else attempt(runItem(e.item, e.mods));
      return;
    case "menu.context":
      e.item.onContextMenu?.(e.at);
      return;
    case "menu.close":
      closePopup();
      return;
    case "menu.sibling": {
      const n = useConfig.getState().menu.length;
      const i = openBarIndex();
      if (i >= 0 && n) openMenuBar((i + e.dir + n) % n, true);
      return;
    }
    case "menubar.layout":
      setState({ layout: { ...s.layout, menuBar: e.at } });
      return;
    case "menubar.press":
      if (openBarIndex() === e.index) closePopup();
      else openMenuBar(e.index, false);
      return;
    case "menubar.hover": {
      const i = openBarIndex();
      if (i >= 0 && i !== e.index) openMenuBar(e.index, false);
      return;
    }
    case "link.click":
      attempt(clickLink(e.index, e.middle ? { ...e.mods, ctrl: true } : e.mods, e.at));
      return;
    case "link.hover":
      hoverLink(e.index, e.at);
      return;
    case "link.context":
      attempt(native(contextLink(e.index, e.at)));
      return;

    // ------------------------------------------------------------ tabs
    case "tab.click":
      setTabs((t) => (e.mods.ctrl ? T.toggleShown(t, e.id) : T.clickTab(t, e.id)));
      return;
    case "tab.doubleClick":
      setTabs((t) => T.toggleLock(t, e.id));
      return;
    case "tab.middleClick":
      closeTabs([e.id]);
      return;
    case "tab.wheel":
      setTabs((t) => T.wheelTabs(t, e.dir));
      return;
    case "tab.dragOver": {
      const to = s.tabs.tabs.findIndex((t) => t.id === e.over);
      if (to >= 0 && e.id !== e.over) setTabs((t) => T.moveTab(t, e.id, to));
      return;
    }
    case "tab.context":
      openPopup(tabMenuItems(e.id), e.at.x, e.at.y);
      return;

    // ------------------------------------------------------------ panes
    case "pane.press":
      if (s.tabs.currentId !== e.id) setTabs((t) => T.focusTab(t, e.id));
      return;
    case "pane.widths":
      setState({ paneWidths: { ...s.paneWidths, ...e.widths } });
      return;
    case "pane.rowSplit":
      setState({ paneRowSplit: e.split });
      return;
    case "pane.arrange":
      if (s.paneWidths || s.paneRowSplit !== null) setState({ paneWidths: null, paneRowSplit: null });
      return;
    case "pane.listWidth": {
      const listWidths = { ...s.layout.listWidths };
      if (e.width === null) delete listWidths[e.id];
      else listWidths[e.id] = e.width;
      setState({ layout: { ...s.layout, listWidths } });
      return;
    }
    case "pane.history":
      attempt(goHistory(e.id, e.dir));
      return;

    // ------------------------------------------------------------ address bar
    case "address.editing":
      if (e.on) setState({ addressEditing: e.id });
      else if (s.addressEditing === e.id) setState({ addressEditing: null });
      if (!e.on) forgetSuggestions(e.id);
      return;
    case "address.input":
      attempt(suggestFor(e.id, e.text));
      return;
    case "address.commit": {
      const text = e.text.trim();
      if (!text) return;
      // When it could not be opened the reason is in the status bar and the field keeps the text.
      attempt(openInput(text, e.mods, e.id).then((opened) => opened && focusPane("list", e.id)));
      return;
    }
    case "address.cancel":
      focusPane("list", e.id);
      return;
    case "address.dropdown":
      if (popupOwner() === `address:${e.id}`) {
        if (e.toggle) closePopup();
        return;
      }
      attempt(ancestorItems(e.id).then((items) => items.length && openPopup(items, e.at.x, e.at.y, `address:${e.id}`)));
      return;
    case "address.dragIcon": {
      const folder = s.panes[e.id]?.folder;
      if (folder) attempt(native(backend.startDrag([folder.location])));
      return;
    }
    case "address.contextIcon": {
      const folder = s.panes[e.id]?.folder;
      if (folder)
        attempt(native(backend.showContextMenu(folder.parent ?? "DESKTOP", [folder.location], e.at.x, e.at.y)));
      return;
    }

    // ------------------------------------------------------------ list
    case "list.press": {
      const p = s.panes[e.id];
      if (!p) return;
      if (pressOnItem(p, e.item, e.mods) === "wait") {
        // Kept for a drag; collapses to this item if the button comes up without one.
        setCursor(e.id, e.item);
        waitingPress.set(e.id, e.item);
      } else {
        waitingPress.delete(e.id);
        clickItem(e.id, e.item, e.mods);
      }
      return;
    }
    case "list.release":
      if (waitingPress.get(e.id) === e.item) clickItem(e.id, e.item, { ctrl: false, shift: false });
      waitingPress.delete(e.id);
      return;
    case "list.pressEmpty":
      waitingPress.delete(e.id);
      if (!e.additive) setSelection(e.id, []);
      return;
    case "list.marquee":
      setSelection(e.id, e.items);
      return;
    case "list.drag": {
      waitingPress.delete(e.id);
      const p = s.panes[e.id];
      if (!p || s.native) return;
      if (e.button === "left") {
        // Pressing an item with Ctrl may have just taken it out of the selection: then it is not dragged.
        if (!p.selected.has(e.item)) return;
      } else if (!p.selected.has(e.item)) {
        clickItem(e.id, e.item, { ctrl: false, shift: false });
      }
      const items = selectedLocations(e.id);
      attempt(
        native(backend.startDrag(items.length ? items : [e.item]), e.button === "right" ? RIGHT_DRAG_TAIL_MS : 0),
      );
      return;
    }
    case "list.doubleClick": {
      if (e.item === null) return attempt(goUp(e.id, e.mods));
      const p = s.panes[e.id];
      if (!p) return;
      const item = ordered(p).entries.find((x) => x.location === e.item);
      attempt(openEntries(e.id, openTargets(selectedEntries(p), item, e.item), e.mods));
      return;
    }
    case "list.middleClick":
      // Empty space goes up; a middle click on an item does nothing.
      if (e.item === null) attempt(goUp(e.id));
      return;
    case "list.context": {
      // The click that ends a right-button drag is not a request for the menu.
      const folder = s.panes[e.id]?.folder;
      if (s.native || !folder) return;
      prepareContext(e.id, e.item);
      attempt(shellMenu(folder.location, e.item ? selectedLocations(e.id) : [], e.at));
      return;
    }
    case "list.key":
      listKey(e.id, e.key, e.mods, e.grid);
      return;
    case "list.zoom":
      if (s.panes[e.id]?.view.mode === "thumbnail") {
        attempt(setOption("ThumbnailSize", stepThumbnailSize(s.options.ThumbnailSize, e.dir)));
      }
      return;
    case "list.sort":
      setView(e.id, (v) => (v.sortKey === e.key ? { sortDesc: !v.sortDesc } : { sortKey: e.key, sortDesc: false }));
      return;
    case "list.contextHeader":
      openPopup(columnMenuItems(), e.at.x, e.at.y);
      return;
    case "list.moveColumn": {
      const shown = visibleColumns(s.options.Columns, !!s.panes[e.id]?.folder?.syncRoot);
      attempt(setOption("Columns", moveShownColumn(s.options.Columns, shown, e.key, e.to)));
      return;
    }
    case "list.columnWidth":
      // Column widths are shared by all folders and panes (docs/spec/listing.md「列のカスタマイズ」).
      attempt(setOption("ColumnWidths", { ...s.options.ColumnWidths, [e.key]: e.width }));
      return;
    case "list.fitColumn": {
      const p = s.panes[e.id];
      if (p) attempt(setOption("ColumnWidths", { ...s.options.ColumnWidths, [e.key]: fitWidth(e.key, p.entries) }));
      return;
    }
    case "rename.end":
      if (s.panes[e.id]?.renaming !== e.item) return;
      updatePane(e.id, () => ({ renaming: null }));
      if (e.refocus) focusPane("list", e.id);
      if (e.name !== null) attempt(rename(e.id, e.item, e.name));
      return;

    // ------------------------------------------------------------ dialogs
    case "dialog.confirm": {
      const kind = s.dialog?.kind;
      const id = s.tabs.currentId;
      closeDialog();
      if (kind === "location") {
        const input = e.text.trim() || "HOME";
        rememberLocation(input);
        attempt(openExternal(input, e.mods));
      } else if (kind === "goLocation") {
        attempt(openInput(e.text.trim() || "HOME", e.mods, id));
      } else if (kind === "newFile") {
        attempt(newItem(id, e.text));
      } else if (kind === "pattern" && id) {
        selectPattern(id, e.text);
      }
      return;
    }
    case "dialog.close":
      closeDialog();
      return;
  }
}

// ---------------------------------------------------------------- window input

/** A key press as the root needs it (input.ts fills it in from the DOM event). */
export interface KeyInput {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  /** The focus is in a text field. */
  inText: boolean;
  /** The focus is in a pane's list (keyboard-folder.xml applies). */
  inList: boolean;
  /** Where a menu bound to the key opens: the middle of the list with the focus, or of the window. */
  at: Point;
}

let alt: AltPress = NO_ALT;

/** A key went down anywhere in the window. True when the root has dealt with it (nothing else should). */
export function keyDown(k: KeyInput): boolean {
  alt = trackAlt(alt, { type: "keydown", key: k.key, repeat: k.repeat }).press;
  const m = mode();

  // Alt+letter opens that menu of the menu bar, from wherever the focus is.
  if (k.altKey && !k.ctrlKey && altAloneAllowed(m) && getState().options.MenuVisible) {
    const i = barItemFor(barAccessKeys(), k.key, false);
    if (i >= 0) {
      openMenuBar(i, true);
      return true;
    }
  }

  switch (routeKey(m, k.inText)) {
    case "dialog":
      // The only dialog without an OK button is closed by Enter as well.
      if (k.key === "Escape" || (k.key === "Enter" && getState().dialog?.kind === "about")) {
        closeDialog();
        return true;
      }
      return false;
    case "menubar": {
      const hot = getState().menuBarHot ?? 0;
      const r = menuBarKey(hot, barAccessKeys(), k.key, k.ctrlKey);
      if (!r) return false;
      if ("hot" in r) setState({ menuBarHot: r.hot });
      else if ("open" in r) openMenuBar(r.open, true);
      else setState({ menuBarHot: null });
      return true;
    }
    case "bindings": {
      const binding = bindingFor(k, k.inList);
      if (!binding) return false;
      const item = binding.item;
      if (item.children?.length) openPopup(item.children, k.at.x, k.at.y);
      else attempt(runItem(item, modsOf(k), k.repeat));
      return true;
    }
    case "text": {
      // The field has the keys. One binding still runs while a name is being edited: the rename
      // command itself, which then changes the part of the name that is selected.
      if (m.kind !== "edit" || m.field !== "rename") return false;
      const item = bindingFor(k, true)?.item;
      if (!item?.command || parseCommand(item.command).name !== "Current.Rename") return false;
      attempt(runItem(item, modsOf(k), k.repeat));
      return true;
    }
    default:
      // "popup": the menu with the focus handles its keys. "none": Windows does.
      return false;
  }
}

/** A key came up. True when it was Alt pressed alone and the root acted on it. */
export function keyUp(key: string): boolean {
  const r = trackAlt(alt, { type: "keyup", key });
  alt = r.press;
  if (!r.alone || !altAloneAllowed(mode())) return false;
  const s = getState();
  if (!s.options.MenuVisible) {
    // A hidden menu bar could otherwise only be brought back by editing config.json.
    attempt(setOption("MenuVisible", true));
  } else if (s.popup) {
    closePopup();
  } else {
    setState({ menuBarHot: s.menuBarHot === null ? 0 : null });
  }
  return true;
}

/**
 * A pointer button went down anywhere in the window. `inPopup`: on the open popup menu;
 * `onAnchor`: on a button that opens and closes its menu itself (a menu bar item, the ▼ of an
 * address bar).
 */
export function pointerDown(inPopup: boolean, onAnchor: boolean) {
  alt = trackAlt(alt, { type: "pointerdown" }).press;
  const s = getState();
  if (s.menuBarHot !== null) setState({ menuBarHot: null });
  if (s.popup && !inPopup && !onAnchor) closePopup();
}

/** The window lost the focus: an open menu would be left hanging over other windows. */
export function windowBlur() {
  alt = NO_ALT;
  closePopup();
  if (getState().menuBarHot !== null) setState({ menuBarHot: null });
}
