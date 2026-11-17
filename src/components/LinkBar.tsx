// Link bar (link.xml). Spec: docs/spec/config.md「link.xml」
import { useEffect, useState, type MouseEvent } from "react";
import { iconUrl } from "../api/backend";
import { useConfig } from "../config/store";
import type { MenuItem } from "../config/types";
import { modsOf } from "../model/input";
import { menuLabel } from "../model/menu";
import type { Mods } from "../model/navigation";
import { linkHasMenu, linkMenuItems, resolveLink, runLink, showLinkMenu, type LinkTarget } from "../state/links";
import { isSeparator, openPopup, popupOwner, switchesOnHover } from "../state/popup";
import { MISSING_MARK, missingTitle, splitLabel } from "./PopupMenu";
import "../styles/chrome.css";

/** Owner prefix of popups opened from the link bar. */
const LINK_OWNER = "link:";

/** Bumped on every open request, so only the latest of several slow folder listings opens. */
let openSeq = 0;

function LinkButton({ cfg, owner }: { cfg: MenuItem; owner: string }) {
  // undefined: not resolved yet. null: the path was not found.
  const [loc, setLoc] = useState<LinkTarget | null | undefined>(undefined);
  const path = cfg.path;
  useEffect(() => {
    if (!path) return;
    let alive = true;
    void resolveLink(path).then((r) => alive && setLoc(r));
    return () => {
      alive = false;
    };
    // `cfg` changes when the settings are reloaded: resolve again even if the path text is the same.
  }, [path, cfg]);

  const isDrop = linkHasMenu(cfg, loc);
  const missing = !!path && loc === null;
  const { before, key, after } = splitLabel(cfg);

  /** Opens this button's menu. `hover`: switching from another link menu, dropped if that menu closed meanwhile. */
  const openDrop = async (target: HTMLElement, hover = false) => {
    const seq = ++openSeq;
    const items = await linkMenuItems(cfg);
    if (seq !== openSeq) return;
    if (hover && !popupOwner()?.startsWith(LINK_OWNER)) return;
    const r = target.getBoundingClientRect();
    openPopup(items, r.left, r.bottom, owner);
  };

  const click = async (e: MouseEvent<HTMLButtonElement>, mods: Mods) => {
    const target = e.currentTarget;
    // A path not found before is looked up again: the drive may be back.
    const l = loc ?? (cfg.path ? await resolveLink(cfg.path) : null);
    if (cfg.path && l !== loc) setLoc(l);
    if (linkHasMenu(cfg, l)) await openDrop(target);
    else if (l) await runLink(cfg, l, mods);
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
        if (loc) showLinkMenu(e, loc.parent, loc.location);
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
