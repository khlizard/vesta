// Link bar (link.xml). Spec: docs/spec/config.md「link.xml」
import { useEffect, useState, type MouseEvent } from "react";
import { backend, iconUrl } from "../api/backend";
import { linkAction, menuLabel, runItem } from "../commands/items";
import { useConfig } from "../config/store";
import type { MenuItem } from "../config/types";
import { modsOf } from "../model/input";
import type { Mods } from "../model/navigation";
import { isSeparator, openPopup, popupOwner, switchesOnHover, type PopupItem } from "./popupBus";
import { MISSING_MARK, missingTitle, splitLabel } from "./PopupMenu";
import "../styles/chrome.css";

interface Loc {
  location: string;
  isFolder: boolean;
  /** Location of the containing folder (for the Shell context menu). */
  parent: string;
}

/**
 * Resolved link paths, per loaded settings: reloading the settings (Option.Reload) starts a
 * new cache, so an edited or re-created target is looked up again.
 */
const caches = new WeakMap<MenuItem[], Map<string, Promise<Loc | null>>>();
function cache(): Map<string, Promise<Loc | null>> {
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

/** Resolves a link path (alias, env var, UNC...) once and caches the result. */
function resolvePath(path: string): Promise<Loc | null> {
  const resolved = cache();
  let p = resolved.get(path);
  if (!p) {
    p = backend.resolveLocation(path).then(
      (r): Loc =>
        r.kind === "folder"
          ? { location: r.folder.location, isFolder: true, parent: r.folder.parent ?? "DESKTOP" }
          : { location: r.location, isFolder: false, parent: parentOfFile(r.location) },
      () => {
        resolved.delete(path);
        return null;
      },
    );
    resolved.set(path, p);
  }
  return p;
}

const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

function showMenuFor(e: MouseEvent, parent: string, location: string) {
  e.preventDefault();
  void backend.showContextMenu(parent, [location], e.clientX, e.clientY).catch(() => {});
}

const SEP: PopupItem = { separator: true };

/** Contents of a folder as popup items; sub-folders expand lazily while `depth` allows (undefined = unlimited). */
async function expandFolder(location: string, depth: number | undefined, includeFiles: boolean): Promise<PopupItem[]> {
  const listing = await backend.listFolder(location, false);
  const entries = listing.entries
    .filter((e) => e.isFolder || includeFiles)
    .sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || collator.compare(a.name, b.name));
  const next = depth === undefined ? undefined : depth - 1;
  return entries.map((e): PopupItem => {
    const item: PopupItem = {
      text: e.name,
      literal: true,
      iconSrc: iconUrl(e.location),
      onSelect: (mods: Mods) => void runItem({ path: e.location }, mods),
      onContextMenu: (ev) => showMenuFor(ev, location, e.location),
    };
    if (e.isFolder && next !== 0) item.loadChildren = () => expandFolder(e.location, next, includeFiles);
    return item;
  });
}

/** Builds the popup item for a link.xml entry (children first, then the folder contents). */
async function buildItem(cfg: MenuItem): Promise<PopupItem> {
  if (isSeparator(cfg)) return SEP;
  const loc = cfg.path ? await resolvePath(cfg.path) : null;
  const staticChildren = cfg.children ? await Promise.all(cfg.children.map(buildItem)) : [];
  const expandable = !!loc?.isFolder && cfg.depth !== 0;
  const item: PopupItem = { text: cfg.text };
  if (cfg.path && !loc) {
    // Not found (deleted folder, unplugged drive...): shown greyed; its own children stay usable.
    item.path = cfg.path;
    item.missing = true;
    if (!staticChildren.length) item.disabled = true;
  }
  if (loc) {
    item.iconSrc = iconUrl(loc.location);
    item.onSelect = (mods) => void runItem(linkAction(loc.location, loc.isFolder, cfg.args), mods);
    item.onContextMenu = (ev) => showMenuFor(ev, loc.parent, loc.location);
  }
  if (expandable && loc) {
    item.loadChildren = async () => {
      const content = await expandFolder(loc.location, cfg.depth, !!cfg.includeFiles);
      return staticChildren.length && content.length ? [...staticChildren, SEP, ...content] : [...staticChildren, ...content];
    };
  } else if (staticChildren.length) {
    item.children = staticChildren;
  }
  return item;
}

/** Owner prefix of popups opened from the link bar. */
const LINK_OWNER = "link:";

/** Bumped on every open request, so only the latest of several slow folder listings opens. */
let openSeq = 0;

function LinkButton({ cfg, owner }: { cfg: MenuItem; owner: string }) {
  // undefined: not resolved yet. null: the path was not found.
  const [loc, setLoc] = useState<Loc | null | undefined>(undefined);
  const path = cfg.path;
  useEffect(() => {
    if (!path) return;
    let alive = true;
    void resolvePath(path).then((r) => alive && setLoc(r));
    return () => {
      alive = false;
    };
    // `cfg` changes when the settings are reloaded: resolve again even if the path text is the same.
  }, [path, cfg]);

  const isDrop = !!cfg.children?.length || (!!loc?.isFolder && cfg.depth !== 0);
  const missing = !!path && loc === null;
  const { before, key, after } = splitLabel(cfg);

  /** Opens this button's menu. `hover`: switching from another link menu, dropped if that menu closed meanwhile. */
  const openDrop = async (target: HTMLElement, hover = false) => {
    const seq = ++openSeq;
    const item = await buildItem(cfg);
    const items = item.loadChildren ? await item.loadChildren() : (item.children ?? []);
    if (seq !== openSeq) return;
    if (hover && !popupOwner()?.startsWith(LINK_OWNER)) return;
    const r = target.getBoundingClientRect();
    openPopup(items, r.left, r.bottom, owner);
  };

  const click = async (e: MouseEvent<HTMLButtonElement>, mods: Mods) => {
    const target = e.currentTarget;
    // A path not found before is looked up again: the drive may be back.
    const l = loc ?? (cfg.path ? await resolvePath(cfg.path) : null);
    if (cfg.path && l !== loc) setLoc(l);
    const drop = !!cfg.children?.length || (!!l?.isFolder && cfg.depth !== 0);
    if (drop) await openDrop(target);
    else if (l) await runItem(linkAction(l.location, l.isFolder, cfg.args), mods);
  };

  return (
    <button
      type="button"
      className={missing ? "link-btn missing" : "link-btn"}
      title={missing ? missingTitle(path) : menuLabel(cfg.text).label}
      onClick={(e) => void click(e, modsOf(e))}
      onMouseEnter={(e) => {
        if (switchesOnHover(popupOwner(), owner, LINK_OWNER, isDrop)) void openDrop(e.currentTarget, true);
      }}
      onAuxClick={(e) => {
        if (e.button === 1) void click(e, { ...modsOf(e), ctrl: true });
      }}
      onContextMenu={(e) => {
        if (loc) showMenuFor(e, loc.parent, loc.location);
        else e.preventDefault();
      }}
    >
      {loc && <img src={iconUrl(loc.location)} width={16} height={16} alt="" draggable={false} />}
      {missing && <span className="link-missing">{MISSING_MARK}</span>}
      <span className="link-text">
        {before}
        {key && <u>{key}</u>}
        {after}
      </span>
      {isDrop && <span className="link-arrow">▼</span>}
    </button>
  );
}

export function LinkBar() {
  const link = useConfig((s) => s.link);
  return (
    <div className="linkbar" onMouseDown={(e) => e.preventDefault()}>
      {link.filter((i) => !isSeparator(i)).map((cfg, i) => (
        <LinkButton key={i} cfg={cfg} owner={`${LINK_OWNER}${i}`} />
      ))}
    </div>
  );
}
