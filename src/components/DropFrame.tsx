// The frame around what a drag is over (a folder item, a tab, a pane). One element on top of
// everything: a class on the target itself would be hidden by its children.

import { dropFrameView } from "../presenters/chrome";
import { useView } from "../presenters/view";
import "../styles/pane.css";

export function DropFrame() {
  const frame = useView(dropFrameView);
  if (!frame) return null;
  return <div className="drop-overlay" style={{ display: "block", ...frame }} />;
}
