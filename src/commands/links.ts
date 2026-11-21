// Acting on link bar items (link.xml): their menus, clicks and Shell menus.
// Spec: docs/spec/config.md「link.xml」

import { backend } from "../api/backend";
import { iconUrl } from "../api/urls";
import { useConfig } from "../config/store";
import type { MenuItem } from "../config/types";
import { linkAction } from "../model/execute";
import { errorText } from "../model/input";
import type { Mods } from "../model/navigation";
import { compareNames } from "../model/sort";
import { LINK_OWNER, linkButtons, linkHasMenu, targetOf } from "../state/links";
import { setMessage } from "../state/message";
import { isSeparator, openPopup, popupOwner, switchesOnHover, type PopupItem } from "../state/popup";
import { getState } from "../state/store";
import { runItem } from "./items";

/** The Shell context menu of a link target, at client point (x, y). */
function showLinkMenu(at: { x: number; y: number }, parent: string, location: string): Promise<void> {
  return backend.showContextMenu(parent, [location], at.x, at.y).then(
    () => {},
    (e) => setMessage(errorText(e)),
  );
}

const SEP: PopupItem = { separator: true };

/** Contents of a folder as popup items; sub-folders expand lazily while `depth` allows (undefined = unlimited). */
async function expandFolder(location: string, depth: number | undefined, includeFiles: boolean): Promise<PopupItem[]> {
  const listing = await backend.listFolder(location, false);
  const entries = listing.entries
    .filter((e) => e.isFolder || includeFiles)
    .sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || compareNames(a.name, b.name));
  const next = depth === undefined ? undefined : depth - 1;
  return entries.map((e): PopupItem => {
    const item: PopupItem = {
      text: e.name,
      literal: true,
      iconSrc: iconUrl(e.location),
      onSelect: (mods: Mods) => void runItem({ path: e.location }, mods),
      onContextMenu: (at) => void showLinkMenu(at, location, e.location),
    };
    if (e.isFolder && next !== 0) item.loadChildren = () => expandFolder(e.location, next, includeFiles);
    return item;
  });
}

/** Builds the popup item for a link.xml entry (children first, then the folder contents). */
async function buildItem(cfg: MenuItem): Promise<PopupItem> {
  if (isSeparator(cfg)) return SEP;
  const target = await targetOf(cfg.path);
  const staticChildren = cfg.children ? await Promise.all(cfg.children.map(buildItem)) : [];
  const item: PopupItem = { text: cfg.text };
  if (cfg.path && !target) {
    // Not found (deleted folder, unplugged drive...): shown greyed; its own children stay usable.
    item.path = cfg.path;
    item.missing = true;
    if (!staticChildren.length) item.disabled = true;
  }
  if (target) {
    item.iconSrc = iconUrl(target.location);
    item.onSelect = (mods) => void runItem(linkAction(target.location, target.isFolder, cfg.args), mods);
    item.onContextMenu = (at) => void showLinkMenu(at, target.parent, target.location);
  }
  if (target?.isFolder && cfg.depth !== 0) {
    item.loadChildren = async () => {
      const content = await expandFolder(target.location, cfg.depth, !!cfg.includeFiles);
      return staticChildren.length && content.length
        ? [...staticChildren, SEP, ...content]
        : [...staticChildren, ...content];
    };
  } else if (staticChildren.length) {
    item.children = staticChildren;
  }
  return item;
}

/** Bumped on every open request, so only the latest of several slow folder listings opens. */
let openSeq = 0;

/** Opens the menu of link button `index` at `at`. `hover`: only while another link menu is still open. */
async function openLinkMenu(index: number, cfg: MenuItem, at: { x: number; y: number }, hover: boolean) {
  const seq = ++openSeq;
  const item = await buildItem(cfg);
  const items = item.loadChildren ? await item.loadChildren() : (item.children ?? []);
  if (seq !== openSeq) return;
  if (hover && !popupOwner()?.startsWith(LINK_OWNER)) return;
  openPopup(items, at.x, at.y, `${LINK_OWNER}${index}`);
}

const button = (index: number): MenuItem | undefined => linkButtons(useConfig.getState().link)[index];

/** A link bar button was clicked: its menu opens, or what it points to. */
export async function clickLink(index: number, mods: Mods, at: { x: number; y: number }) {
  const cfg = button(index);
  if (!cfg) return;
  const target = await targetOf(cfg.path);
  if (linkHasMenu(cfg, target)) await openLinkMenu(index, cfg, at, false);
  else if (target) await runItem(linkAction(target.location, target.isFolder, cfg.args), mods);
}

/** The pointer came over a link bar button: while another link menu is open, switch to this one's. */
export function hoverLink(index: number, at: { x: number; y: number }) {
  const cfg = button(index);
  if (!cfg) return;
  const hasMenu = linkHasMenu(cfg, cfg.path ? getState().linkTargets[cfg.path] : null);
  if (switchesOnHover(popupOwner(), `${LINK_OWNER}${index}`, LINK_OWNER, hasMenu))
    openLinkMenu(index, cfg, at, true).catch((e) => setMessage(errorText(e)));
}

/** Right-click on a link bar button: the Shell menu of what it points to. Ends when the menu has closed. */
export async function contextLink(index: number, at: { x: number; y: number }) {
  const cfg = button(index);
  const target = cfg?.path ? getState().linkTargets[cfg.path] : null;
  if (target) await showLinkMenu(at, target.parent, target.location);
}
