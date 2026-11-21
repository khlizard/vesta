// Link bar items (link.xml): what their paths point to. Acting on them is src/commands/links.ts.
// Spec: docs/spec/config.md「link.xml」

import { backend } from "../api/backend";
import { useConfig } from "../config/store";
import type { MenuItem } from "../config/types";
import { isSeparator } from "./popup";
import { getState, setState, type LinkTarget } from "./store";

/** Owner prefix of popups opened from the link bar. */
export const LINK_OWNER = "link:";

/** The buttons of the link bar: link.xml without its separators. */
export function linkButtons(link: MenuItem[]): MenuItem[] {
  return link.filter((i) => !isSeparator(i));
}

function parentOfFile(location: string): string {
  const i = location.lastIndexOf("\\");
  return i > 0 ? location.slice(0, i) : "DESKTOP";
}

/** Looks a link path up now (alias, env var, UNC...) and notes the answer in the store. Null: not found. */
async function resolveLink(path: string): Promise<LinkTarget | null> {
  const target = await backend.resolveLocation(path).then(
    (r): LinkTarget =>
      r.kind === "folder"
        ? { location: r.folder.location, isFolder: true, parent: r.folder.parent ?? "DESKTOP" }
        : { location: r.location, isFolder: false, parent: parentOfFile(r.location) },
    () => null,
  );
  setState((s) => ({ linkTargets: { ...s.linkTargets, [path]: target } }));
  return target;
}

/** The target of a link path: the one found before, else looked up (again: the drive may be back). */
export async function targetOf(path: string | undefined): Promise<LinkTarget | null> {
  if (!path) return null;
  return getState().linkTargets[path] ?? resolveLink(path);
}

/** Looks up every path of the link bar afresh (at startup, and after the settings are read again). */
export async function resolveLinks() {
  setState({ linkTargets: {} });
  const paths = new Set<string>();
  const walk = (items: MenuItem[]) => {
    for (const it of items) {
      if (it.path) paths.add(it.path);
      if (it.children) walk(it.children);
    }
  };
  walk(linkButtons(useConfig.getState().link));
  await Promise.all([...paths].map(resolveLink));
}

/** Whether a link item opens a menu instead of acting on a click. */
export function linkHasMenu(cfg: MenuItem, target: LinkTarget | null | undefined): boolean {
  return !!cfg.children?.length || (!!target?.isFolder && cfg.depth !== 0);
}
