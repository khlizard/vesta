// One pane: address bar + list. Spec: docs/spec/ui.md, tabs.md

import { useEffect, useRef } from "react";
import { goHistory } from "../state/actions";
import { paneClientWidths } from "../state/columns";
import { useStore } from "../state/store";
import { AddressBar } from "./AddressBar";
import { DetailsView } from "./DetailsView";
import { ThumbnailView } from "./ThumbnailView";
import "../styles/pane.css";

export function Pane({ id }: { id: string }) {
  const pane = useStore((s) => s.panes[id]);
  const current = useStore((s) => s.tabs.currentId === id);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => paneClientWidths.set(id, el.clientWidth));
    ro.observe(el);
    return () => {
      ro.disconnect();
      paneClientWidths.delete(id);
    };
  }, [id]);

  if (!pane) return <div className="pane-empty" />;

  const View = pane.view.mode === "thumbnail" ? ThumbnailView : DetailsView;
  return (
    <div
      className={`pane-body${current ? " current" : ""}`}
      onMouseUp={(e) => {
        if (e.button === 3) void goHistory(id, "back");
        else if (e.button === 4) void goHistory(id, "forward");
      }}
    >
      <AddressBar id={id} folder={pane.folder} current={current} />
      <div ref={wrapRef} className={`pane-list${pane.loading ? " loading" : ""}`}>
        <View id={id} pane={pane} current={current} />
        {pane.error && !pane.loading && (
          <div className="pane-error">
            <div className="pane-error-title">このフォルダを開けません</div>
            <div className="pane-error-reason">{pane.error}</div>
            <div className="pane-error-hint">F5 で読み直します。つながると自動で読み直します。</div>
          </div>
        )}
        {pane.loading && <div className="pane-loading" />}
      </div>
    </div>
  );
}
