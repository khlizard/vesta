// In-place rename editor. Spec: docs/spec/fileops.md

import { useEffect, useRef } from "react";
import type { Entry } from "../../api/types";
import { rename } from "../../state/fileActions";
import { updatePane, useStore } from "../../state/store";

export function RenameInput({ id, entry }: { id: string; entry: Entry }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const skipExt = useStore((s) => s.options.RenameExtension);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = entry.name.lastIndexOf(".");
    el.setSelectionRange(0, skipExt && !entry.isFolder && dot > 0 ? dot : entry.name.length);
    // Select once, when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = (commit: boolean) => {
    const el = ref.current;
    if (done.current || !el) return;
    done.current = true;
    const value = el.value;
    el.closest<HTMLElement>("[data-pane-list]")?.focus({ preventScroll: true });
    updatePane(id, () => ({ renaming: null }));
    if (commit) void rename(id, entry.location, value);
  };

  return (
    <input
      ref={ref}
      className="rename"
      defaultValue={entry.name}
      spellCheck={false}
      onKeyDown={(e) => {
        e.stopPropagation();
        // Enter that confirms a Japanese conversion is not the end of the rename.
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    />
  );
}
