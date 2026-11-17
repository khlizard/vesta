// Window layout. Spec: docs/spec/ui.md

import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadOptions, setOption } from "./commands/registry";
import { blockBrowserShortcuts, handleGlobalKeyDown, loadKeyboardLayout } from "./commands/keys";
import { Dialogs } from "./components/Dialogs";
import { loadUiConfig } from "./config/load";
import { LinkBar } from "./components/LinkBar";
import { MenuBar } from "./components/MenuBar";
import { PaneArea } from "./components/PaneArea";
import { StatusBar } from "./components/StatusBar";
import { TabBar } from "./components/TabBar";
import { ToolBar } from "./components/ToolBar";
import { currentTab } from "./model/tabs";
import { startApp } from "./state/startup";
import { getState, useStore } from "./state/store";
import { startUpdateChecks } from "./state/update";
import "./styles/base.css";

function useWindowTitle() {
  const tab = useStore((s) => currentTab(s.tabs));
  const pane = useStore((s) => (s.tabs.currentId ? s.panes[s.tabs.currentId] : null));
  const folder = pane?.folder;
  useEffect(() => {
    const title = tab
      ? `Vesta - ${folder?.displayName ?? tab.displayName} / ${folder?.fsPath ?? folder?.displayName ?? tab.location}`
      : "Vesta";
    void getCurrentWindow().setTitle(title).catch(() => {});
    document.title = title;
  }, [tab, folder]);
}

/** Text size option → the CSS variable every text height is derived from (base.css). */
function useFontSize() {
  const size = useStore((s) => s.options.FontSize);
  useEffect(() => {
    document.documentElement.style.setProperty("--font-size", `${size}px`);
  }, [size]);
}

/**
 * While the menu bar is hidden, pressing Alt alone shows it again (docs/spec/ui.md「画面構成」):
 * otherwise a hidden menu bar could only be brought back by editing config.json.
 */
function useAltShowsMenuBar(hidden: boolean) {
  useEffect(() => {
    if (!hidden) return;
    let alone = false;
    const down = (e: KeyboardEvent) => {
      alone = e.key === "Alt" && !e.ctrlKey && !e.shiftKey && !e.metaKey;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Alt" && alone && !getState().dialog) {
        e.preventDefault();
        void setOption("MenuVisible", true);
      }
      alone = false;
    };
    const cancel = () => {
      alone = false;
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("pointerdown", cancel, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("pointerdown", cancel, true);
    };
  }, [hidden]);
}

export default function App() {
  const options = useStore((s) => s.options);
  useWindowTitle();
  useFontSize();
  useAltShowsMenuBar(!options.MenuVisible);

  useEffect(() => {
    // Every step runs even when an earlier one fails: a broken settings file must not leave the
    // window empty, and the update check must always start (it is how a bad release gets fixed).
    const step = (what: string, f: () => unknown) => async () => {
      try {
        await f();
      } catch (e) {
        console.warn(`startup: ${what}`, e);
      }
    };
    void step("keyboard layout", loadKeyboardLayout)();
    void step("options", loadOptions)()
      .then(step("settings", loadUiConfig))
      .then(step("session", startApp))
      .then(step("updates", startUpdateChecks));
    window.addEventListener("keydown", handleGlobalKeyDown);
    // In development F5 / Ctrl+R keep reloading the page.
    if (!import.meta.env.DEV) window.addEventListener("keydown", blockBrowserShortcuts, true);
    // Block the WebView's own context menu; panes show the Explorer menu instead.
    const noMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", noMenu);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      window.removeEventListener("keydown", blockBrowserShortcuts, true);
      window.removeEventListener("contextmenu", noMenu);
    };
  }, []);

  return (
    <div className="app">
      {options.MenuVisible && <MenuBar />}
      {options.ToolVisible && <ToolBar />}
      {options.LinkVisible && <LinkBar />}
      <TabBar />
      <PaneArea />
      {options.StatusVisible && <StatusBar />}
      <Dialogs />
    </div>
  );
}
