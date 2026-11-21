// Starting the app: the window's input, the settings, the session, and what keeps running after.

import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadKeyboardLayout } from "../commands/keys";
import { isKnownCommand } from "../commands/registry";
import { useConfig } from "../config/store";
import { windowTitle } from "../model/labels";
import { currentTab } from "../model/tabs";
import { resolveLinks } from "../state/links";
import { loadUiConfig } from "../state/uiConfig";
import { logLine } from "../state/log";
import { loadOptions } from "../state/options";
import { startApp } from "../state/startup";
import { setState, useStore, type AppState } from "../state/store";
import { startUpdateChecks } from "../state/update";
import { listenToDrops } from "./drop";
import { listenToWindow } from "./input";

/** The title of the window follows the current tab. */
function followTitle() {
  let shown: string | null = null;
  const show = (s: AppState) => {
    const tab = currentTab(s.tabs);
    const folder = tab ? (s.panes[tab.id]?.folder ?? null) : null;
    const title = windowTitle(tab, folder);
    if (title === shown) return;
    shown = title;
    void getCurrentWindow()
      .setTitle(title)
      .catch(() => {});
    document.title = title;
  };
  show(useStore.getState());
  useStore.subscribe(show);
}

/**
 * Called once, when the window's page is ready. Returns a function that takes the window's
 * listeners off again (the page is reloaded in development).
 */
export function boot(): () => void {
  const stopInput = listenToWindow(!import.meta.env.DEV);
  // Every step runs even when an earlier one fails: a broken settings file must not leave the
  // window empty, and the update check must always start (it is how a bad release gets fixed).
  const step = (what: string, f: () => unknown) => async () => {
    try {
      await f();
    } catch (e) {
      logLine(`startup: ${what}`, e);
    }
  };
  followTitle();
  // The links are looked up again whenever the settings are read (Option.Reload).
  useConfig.subscribe((now, before) => {
    if (now.link !== before.link) void resolveLinks();
  });
  void step("keyboard layout", loadKeyboardLayout)();
  void step("version", async () => setState({ appVersion: await getVersion() }))();
  void step("drops", listenToDrops)();
  void step("options", loadOptions)()
    .then(step("settings", () => loadUiConfig(isKnownCommand)))
    .then(step("session", startApp))
    .then(step("updates", startUpdateChecks));
  return stopInput;
}
