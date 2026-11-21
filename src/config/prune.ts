// Drops the items of usr/*.xml that this app cannot run. Pure: which command names exist is
// passed in (`isKnown`), so this layer does not depend on the command table.
// Spec: docs/spec/config.md

import type { KeyBinding, MenuItem, UiConfig } from "./types";

/** Whether a `command` text (one name, or several joined by `;`) can be run. */
export type IsKnown = (command: string) => boolean;

/** True when the item can do something in this app. */
function usable(item: MenuItem, isKnown: IsKnown): boolean {
  if (item.command) return isKnown(item.command);
  return !!(item.navigate || item.execute || item.path || item.children?.length);
}

/**
 * Removes items with unknown commands, then empty submenus (that have no action of their own),
 * and leading / trailing / doubled separators.
 */
export function pruneItems(items: MenuItem[], isKnown: IsKnown): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    if (it.separator) {
      if (out.length && !out[out.length - 1].separator) out.push(it);
      continue;
    }
    const children = it.children ? pruneItems(it.children, isKnown) : undefined;
    const pruned: MenuItem = children ? { ...it, children } : { ...it };
    if (children && children.length === 0) delete pruned.children;
    const hasAction = !!(it.command || it.navigate || it.execute || it.path);
    if (it.command && !isKnown(it.command)) continue;
    if (!hasAction && !pruned.children?.length) continue;
    if (!usable(pruned, isKnown)) continue;
    out.push(pruned);
  }
  while (out.length && out[out.length - 1].separator) out.pop();
  return out;
}

export function pruneBindings(bindings: KeyBinding[], isKnown: IsKnown): KeyBinding[] {
  return bindings.flatMap((b) => {
    const [item] = pruneItems([b.item], isKnown);
    return item ? [{ ...b, item }] : [];
  });
}

export function pruneConfig(c: UiConfig, isKnown: IsKnown): UiConfig {
  return {
    menu: pruneItems(c.menu, isKnown),
    tool: pruneItems(c.tool, isKnown),
    status: pruneItems(c.status, isKnown),
    // Link items carry paths, not commands: for them this only tidies separators and empty menus.
    link: pruneItems(c.link, isKnown),
    keyForm: pruneBindings(c.keyForm, isKnown),
    keyFolder: pruneBindings(c.keyFolder, isKnown),
  };
}

/** Command names in the settings that this app does not have (each once, in file order). */
export function unknownCommands(c: UiConfig, isKnown: IsKnown): string[] {
  const out = new Set<string>();
  const walk = (items: MenuItem[]) => {
    for (const it of items) {
      if (it.command && !isKnown(it.command)) out.add(it.command);
      if (it.children) walk(it.children);
    }
  };
  for (const items of [c.menu, c.tool, c.status, c.link]) walk(items);
  walk([...c.keyForm, ...c.keyFolder].map((b) => b.item));
  return [...out];
}
