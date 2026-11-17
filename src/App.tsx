// Window layout: every view sits under this one root. Spec: docs/spec/ui.md

import { useEffect } from "react";
import { Dialogs } from "./components/Dialogs";
import { DropFrame } from "./components/DropFrame";
import { LinkBar } from "./components/LinkBar";
import { MenuBar } from "./components/MenuBar";
import { PaneArea } from "./components/PaneArea";
import { PopupHost } from "./components/PopupMenu";
import { StatusBar } from "./components/StatusBar";
import { TabBar } from "./components/TabBar";
import { ToolBar } from "./components/ToolBar";
import { appView } from "./presenters/chrome";
import { useView } from "./presenters/view";
import { boot } from "./root/boot";
import "./styles/base.css";

export default function App() {
  const vm = useView(appView);

  // Text size option → the CSS variable every text height is derived from (base.css).
  useEffect(() => {
    document.documentElement.style.setProperty("--font-size", `${vm.fontSize}px`);
  }, [vm.fontSize]);

  useEffect(() => boot(), []);

  return (
    <div className="app">
      {vm.menuBar && <MenuBar />}
      {vm.toolBar && <ToolBar />}
      {vm.linkBar && <LinkBar />}
      <TabBar />
      <PaneArea />
      {vm.statusBar && <StatusBar />}
      <DropFrame />
      <PopupHost />
      <Dialogs />
    </div>
  );
}
