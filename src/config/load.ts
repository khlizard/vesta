// Loads usr/*.xml through the backend and drops items the app does not implement.
// Spec: docs/spec/config.md

import { invoke } from "@tauri-apps/api/core";
import { defineCommand, isKnownCommand } from "../commands/registry";
import { errorText } from "../model/input";
import { setMessage } from "../state/actions";
import { useConfig } from "./store";
import type { KeyBinding, MenuItem, UiConfig } from "./types";

interface UiConfigResponse {
  config: UiConfig;
  warnings: string[];
  usrDir: string;
}

/** True when the item can do something in this app. */
function usable(item: MenuItem): boolean {
  if (item.command) return isKnownCommand(item.command);
  return !!(item.navigate || item.execute || item.path || item.children?.length);
}

/**
 * Removes items with unknown commands, then empty submenus (that have no action of their own),
 * and leading / trailing / doubled separators.
 */
export function pruneItems(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    if (it.separator) {
      if (out.length && !out[out.length - 1].separator) out.push(it);
      continue;
    }
    const children = it.children ? pruneItems(it.children) : undefined;
    const pruned: MenuItem = children ? { ...it, children } : { ...it };
    if (children && children.length === 0) delete pruned.children;
    const hasAction = !!(it.command || it.navigate || it.execute || it.path);
    if (it.command && !isKnownCommand(it.command)) continue;
    if (!hasAction && !pruned.children?.length) continue;
    if (!usable(pruned)) continue;
    out.push(pruned);
  }
  while (out.length && out[out.length - 1].separator) out.pop();
  return out;
}

export function pruneBindings(bindings: KeyBinding[]): KeyBinding[] {
  return bindings.flatMap((b) => {
    const [item] = pruneItems([b.item]);
    return item ? [{ ...b, item }] : [];
  });
}

export function pruneConfig(c: UiConfig): UiConfig {
  return {
    menu: pruneItems(c.menu),
    tool: pruneItems(c.tool),
    status: pruneItems(c.status),
    // Link items carry paths, not commands; only separators need tidying.
    link: pruneItems(c.link),
    keyForm: pruneBindings(c.keyForm),
    keyFolder: pruneBindings(c.keyFolder),
  };
}

/** Command names in the settings that this app does not have (each once, in file order). */
export function unknownCommands(c: UiConfig): string[] {
  const out = new Set<string>();
  const walk = (items: MenuItem[]) => {
    for (const it of items) {
      if (it.command && !isKnownCommand(it.command)) out.add(it.command);
      if (it.children) walk(it.children);
    }
  };
  for (const items of [c.menu, c.tool, c.status, c.link]) walk(items);
  walk([...c.keyForm, ...c.keyFolder].map((b) => b.item));
  return [...out];
}

/** Loads the settings. Returns the unknown command names (items using them are left out). */
export async function loadUiConfig(): Promise<string[]> {
  try {
    const r = await invoke<UiConfigResponse>("get_ui_config");
    useConfig.setState(pruneConfig(r.config));
    for (const w of r.warnings) console.warn(w);
    if (r.warnings.length) setMessage(`設定ファイルの一部を読めませんでした: ${r.warnings[0]}`);
    const unknown = unknownCommands(r.config);
    if (unknown.length) console.warn(`unknown commands in usr/*.xml: ${unknown.join(", ")}`);
    return unknown;
  } catch (e) {
    // The backend answers with the built-in settings even when usr/ cannot be used, so this
    // only happens if the call itself fails; the window then has no menus until a reload works.
    console.warn("get_ui_config failed", e);
    setMessage(`設定ファイルを読めませんでした: ${errorText(e)}`);
    return [];
  }
}

defineCommand("Option.Reload", {
  run: async () => {
    const unknown = await loadUiConfig();
    // At startup unknown commands are only logged (settings copied from Avesta have many).
    // After a reload the user has just edited a file, so a mistyped name is worth showing.
    if (unknown.length) {
      setMessage(`設定ファイルを読み直しました。使えないコマンド ${unknown.length} 件：${unknown.slice(0, 3).join("、")}${unknown.length > 3 ? " ほか" : ""}`, 8000);
    } else {
      setMessage("設定ファイルを読み直しました", 2000);
    }
  },
});
