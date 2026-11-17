// Drops on the window: what is dropped from Explorer, a browser or our own drag arrives through
// the "drag-drop" event of the window's drop target (src-tauri/src/droptarget/), with a point.
// The root finds what is under the point and decides. Spec: docs/spec/fileops.md, docs/spec/tabs.md
//
// The decisions themselves are pure functions in state/dnd.ts (tested there).

import { listen } from "@tauri-apps/api/event";
import { backend } from "../api/backend";
import { errorText } from "../model/input";
import { setShown } from "../model/tabs";
import {
  createHoverTimer,
  HOVER_SHOW_MS,
  isNoopDrop,
  isSelfDrop,
  resolveTarget,
  rightDropItems,
  toCssPoint,
  type DragDropPayload,
  type DropAttrs,
  type DropTarget,
} from "../state/dnd";
import { dropFiles, saveDropped } from "../state/fileActions";
import { setMessage } from "../state/message";
import { openDroppedFolders } from "../state/navigation";
import { openPopup } from "../state/popup";
import { getState, setState } from "../state/store";
import { setTabs } from "../state/tabActions";

function attrsOf(el: Element): DropAttrs {
  return {
    folder: el.getAttribute("data-drop-folder"),
    tab: el.getAttribute("data-drop-tab"),
    pane: el.getAttribute("data-drop-pane"),
  };
}

/** What is under a point of the drop event, and the element to frame. */
function hitTest(pos: { x: number; y: number }): { target: DropTarget; element: Element } | null {
  const css = toCssPoint(pos, window.devicePixelRatio);
  const start = document.elementFromPoint(css.x, css.y);
  const els: Element[] = [];
  for (let el: Element | null = start; el; el = el.parentElement) els.push(el);
  const { tabs, panes } = getState();
  const target = resolveTarget(
    els.map(attrsOf),
    (id) => tabs.tabs.find((t) => t.id === id)?.location ?? null,
    (id) => panes[id]?.folder?.location ?? tabs.tabs.find((t) => t.id === id)?.location ?? null,
  );
  return target ? { target, element: els[target.index] } : null;
}

/**
 * The drop target highlight: one frame on top of everything, placed over the target element.
 * (A class on the target itself is hidden by its children, e.g. a pane under its list.)
 */
function frame(target: Element | null) {
  if (!target) {
    if (getState().dropFrame) setState({ dropFrame: null });
    return;
  }
  const r = target.getBoundingClientRect();
  const now = getState().dropFrame;
  if (now && now.left === r.left && now.top === r.top && now.width === r.width && now.height === r.height) return;
  setState({ dropFrame: { left: r.left, top: r.top, width: r.width, height: r.height } });
}

/** Subscribes to drag & drop events once. Returns an unsubscribe function. */
export async function listenToDrops(): Promise<() => void> {
  // Paths of the current drag (only the enter event carries them).
  let dragged: string[] = [];
  const hover = createHoverTimer(HOVER_SHOW_MS, (tabId) => {
    setTabs((s) => setShown(s, [tabId], true));
  });
  const clear = () => {
    frame(null);
    hover.cancel();
    dragged = [];
  };

  const unlisten = await listen<DragDropPayload>("drag-drop", (event) => {
    const p = event.payload;
    if (p.type === "leave") {
      clear();
      return;
    }
    if (p.type === "enter") dragged = p.paths;
    const hit = hitTest(p.position);
    if (p.type === "enter" || p.type === "over") {
      // Re-placed on every move: the list may scroll under the pointer.
      frame(hit && !isNoopDrop(dragged, hit.target.location) ? hit.element : null);
      const tab = hit?.target.kind === "tab" ? hit.target : null;
      const hidden = tab && getState().tabs.tabs.find((t) => t.id === tab.tabId)?.shown === false;
      hover.set(tab && hidden ? tab.tabId : null);
      return;
    }
    // drop
    clear();
    if (p.error) setMessage(`ドロップしたものを保存できません: ${p.error}`);
    if (!p.paths.length) return;
    if (!hit) {
      // On a bar: folders open in tabs. Saved data (temporary files) has nowhere to go.
      if (!p.saving) void backend.keyState().then((mods) => openDroppedFolders(p.paths, mods));
      return;
    }
    const dest = hit.target.location;
    if (isSelfDrop(p.paths, dest)) return;
    if (p.rightButton && !p.saving) {
      // The Shell's own menu, so that drag-and-drop extensions (FastCopy, archivers) are in it.
      // Our menu is the fallback where the Shell has no drop target for the folder.
      backend.rightDrop(p.paths, dest, p.position.x, p.position.y).catch(() => {
        const at = toCssPoint(p.position, window.devicePixelRatio);
        openPopup(rightDropItems(p.paths, dest), at.x, at.y);
      });
      return;
    }
    void (async () => {
      try {
        if (p.saving) {
          await saveDropped(p.paths, dest);
          return;
        }
        const mods = await backend.keyState();
        await dropFiles(p.paths, dest, mods);
      } catch (e) {
        setMessage(errorText(e));
      }
    })();
  });

  return () => {
    unlisten();
    clear();
  };
}
