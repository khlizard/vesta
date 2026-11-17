// Link bar items (link.xml): resolving their paths and building their menus.
// Spec: docs/spec/config.md「link.xml」

import type { MouseEvent } from "react";
import { backend, iconUrl } from "../api/backend";
import { linkAction, runItem } from "../commands/items";
import { useConfig } from "../config/store";
import type { MenuItem } from "../config/types";
import type { Mods } from "../model/navigation";
import { compareNames } from "../model/sort";
import { isSeparator, type PopupItem } from "./popup";

/** Where a link item points. */
export interface LinkTarget {
  location: string;
  isFolder: boolean;
  /** Location of the containing folder (for the Shell context menu). */
  parent: string;
}

/**
 * Resolved link paths, per loaded settings: reloading the settings (Option.Reload) starts a
 * new cache, so an edited or re-created target is looked up again.
 */
const caches = new WeakMap<MenuItem[], Map<string, Promise<LinkTarget | null>>>();
function cache(): Map<string, Promise<LinkTarget | null>> {
  const link = useConfig.getState().link;
  let m = caches.get(link);
  if (!m) {
    m = new Map();
    caches.set(link, m);
  }
  return m;
}

function parentOfFile(location: string): string {
  const i = location.lastIndexOf("\\");
  return i > 0 ? location.slice(0, i) : "DESKTOP";
}

/** Resolves a link path (alias, env var, UNC...) once and caches the result. Null when it is not found. */
export function resolveLink(path: string): Promise<LinkTarget | null> {
  const resolved = cache();
  let p = resolved.get(path);
  if (!p) {
    p = backend.resolveLocation(path).then(
      (r): LinkTarget =>
        r.kind === "folder"
          ? { location: r.folder.location, isFolder: true, parent: r.folder.parent ?? "DESKTOP" }
          : { location: r.location, isFolder: false, parent: parentOfFile(r.location) },
      () => {
        // Not kept: the drive may be back the next time it is asked for.
        resolved.delete(path);
        return null;
      },
    );
    resolved.set(path, p);
  }
  return p;
}

/** Whether a link item opens a menu instead of acting on a click. */
export function linkHasMenu(cfg: MenuItem, target: LinkTarget | null | undefined): boolean {
  return !!cfg.children?.length || (!!target?.isFolder && cfg.depth !== 0);
}

/** Opens what a link item points to. */
export function runLink(cfg: MenuItem, target: LinkTarget, mods: Mods) {
  return runItem(linkAction(target.location, target.isFolder, cfg.args), mods);
}

/** The Shell context menu of a link target, at the pointer. */
export function showLinkMenu(e: MouseEvent, parent: string, location: string) {
  e.preventDefault();
  void backend.showContextMenu(parent, [location], e.clientX, e.clientY).catch(() => {});
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
      onContextMenu: (ev) => showLinkMenu(ev, location, e.location),
    };
    if (e.isFolder && next !== 0) item.loadChildren = () => expandFolder(e.location, next, includeFiles);
    return item;
  });
}

/** Builds the popup item for a link.xml entry (children first, then the folder contents). */
async function buildItem(cfg: MenuItem): Promise<PopupItem> {
  if (isSeparator(cfg)) return SEP;
  const target = cfg.path ? await resolveLink(cfg.path) : null;
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
    item.onSelect = (mods) => void runLink(cfg, target, mods);
    item.onContextMenu = (ev) => showLinkMenu(ev, target.parent, target.location);
  }
  if (target?.isFolder && cfg.depth !== 0) {
    item.loadChildren = async () => {
      const content = await expandFolder(target.location, cfg.depth, !!cfg.includeFiles);
      return staticChildren.length && content.length ? [...staticChildren, SEP, ...content] : [...staticChildren, ...content];
    };
  } else if (staticChildren.length) {
    item.children = staticChildren;
  }
  return item;
}

/** The menu a link bar button drops down. */
export async function linkMenuItems(cfg: MenuItem): Promise<PopupItem[]> {
  const item = await buildItem(cfg);
  return item.loadChildren ? item.loadChildren() : (item.children ?? []);
}
