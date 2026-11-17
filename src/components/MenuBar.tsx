// Menu bar (menu.xml). What Alt, the arrow keys and the access keys do is decided by the root
// (docs/spec/ui.md「モード」); the bar draws which item is open or highlighted.

import { useLayoutEffect, useRef } from "react";
import { menuBarView } from "../presenters/chrome";
import { useView } from "../presenters/view";
import { dispatch } from "../root/dispatch";
import { POPUP_ANCHOR_ATTR } from "../root/input";
import "../styles/chrome.css";

export function MenuBar() {
  const vm = useView(menuBarView);
  const barRef = useRef<HTMLDivElement>(null);

  // The root opens the menus (also from the keyboard), so it is told where the items are.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const items = [...bar.children];
    const report = () =>
      dispatch({
        type: "menubar.layout",
        at: items.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.bottom };
        }),
      });
    report();
    // The items move when the text size or the window changes.
    const watch = new ResizeObserver(report);
    watch.observe(bar);
    for (const el of items) watch.observe(el);
    return () => watch.disconnect();
  }, [vm.items]);

  return (
    <div className="menubar" role="menubar" ref={barRef}>
      {vm.items.map(({ before, key, after }, i) => (
        <button
          key={i}
          type="button"
          className={`menubar-item${vm.open === i ? " open" : ""}${vm.hot === i ? " hot" : ""}`}
          tabIndex={-1}
          {...{ [POPUP_ANCHOR_ATTR]: "" }}
          onMouseDown={(e) => {
            // The list keeps the focus until the menu takes it.
            e.preventDefault();
            dispatch({ type: "menubar.press", index: i });
          }}
          onMouseEnter={() => dispatch({ type: "menubar.hover", index: i })}
        >
          {before}
          {key && <u>{key}</u>}
          {after}
        </button>
      ))}
    </div>
  );
}
