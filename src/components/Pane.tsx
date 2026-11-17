// One pane: address bar + list. Spec: docs/spec/ui.md, tabs.md

import { useEffect, useMemo, useRef } from "react";
import { paneView } from "../presenters/pane";
import { useView } from "../presenters/view";
import { dispatch } from "../root/dispatch";
import { AddressBar } from "./AddressBar";
import { DetailsView } from "./DetailsView";
import { ThumbnailView } from "./ThumbnailView";
import "../styles/pane.css";

export function Pane({ id }: { id: string }) {
  const v = useView(useMemo(() => paneView(id), [id]));
  const wrapRef = useRef<HTMLDivElement>(null);

  // The root needs the width of the list (to fit the columns in it).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let width = -1;
    const ro = new ResizeObserver(() => {
      // The height changes far more often, and is of no interest.
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      dispatch({ type: "pane.listWidth", id, width });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      dispatch({ type: "pane.listWidth", id, width: null });
    };
    // The list is only there once the pane is.
  }, [id, v.exists]);

  if (!v.exists) return <div className="pane-empty" />;

  const View = v.mode === "thumbnail" ? ThumbnailView : DetailsView;
  return (
    <div
      className={`pane-body${v.current ? " current" : ""}`}
      onMouseUp={(e) => {
        if (e.button === 3) dispatch({ type: "pane.history", id, dir: "back" });
        else if (e.button === 4) dispatch({ type: "pane.history", id, dir: "forward" });
      }}
    >
      <AddressBar id={id} />
      <div ref={wrapRef} className={`pane-list${v.loading ? " loading" : ""}`}>
        <View id={id} />
        {v.error !== null && (
          <div className="pane-error">
            <div className="pane-error-title">このフォルダを開けません</div>
            <div className="pane-error-reason">{v.error}</div>
            <div className="pane-error-hint">F5 で読み直します。つながると自動で読み直します。</div>
          </div>
        )}
        {v.loading && <div className="pane-loading" />}
      </div>
    </div>
  );
}
