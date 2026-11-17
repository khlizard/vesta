// What the link bar (link.xml) draws. Spec: docs/spec/config.md「link.xml」

import { iconUrl } from "../api/urls";
import type { MenuItem } from "../config/types";
import { menuLabel } from "../model/menu";
import { linkButtons, linkHasMenu } from "../state/links";
import type { LinkTarget } from "../state/store";
import { itemLabel, MISSING_MARK, type ItemLabel } from "./items";
import { presenter } from "./view";

export interface LinkButtonView {
  /** Which button this is, for the events it sends. */
  index: number;
  label: ItemLabel;
  title: string;
  /** Icon of what the button points to; null until that is known, and when it was not found. */
  icon: string | null;
  /** Its path was not found: drawn greyed, with this mark in place of the icon. */
  missing: string | null;
  /** It opens a menu: drawn with an arrow. */
  arrow: boolean;
}

function button(cfg: MenuItem, index: number, targets: Record<string, LinkTarget | null>): LinkButtonView {
  // undefined: not looked up yet. null: the path was not found.
  const target = cfg.path ? targets[cfg.path] : undefined;
  const missing = !!cfg.path && target === null;
  return {
    index,
    label: itemLabel(cfg),
    title: missing ? `見つかりません: ${cfg.path ?? ""}` : menuLabel(cfg.text).label,
    icon: target ? iconUrl(target.location) : null,
    missing: missing ? MISSING_MARK : null,
    arrow: linkHasMenu(cfg, target),
  };
}

export const linkBarView = presenter(
  (s) => [s.config.link, s.app.linkTargets] as const,
  (link, targets): LinkButtonView[] => linkButtons(link).map((cfg, i) => button(cfg, i, targets)),
);
