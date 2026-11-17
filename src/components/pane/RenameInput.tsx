// In-place rename editor. Spec: docs/spec/fileops.md

import { useEffect, useRef } from "react";
import { isImeKey } from "../../model/input";
import type { Entry } from "../../presenters/list";
import { dispatch } from "../../root/dispatch";

interface Props {
  id: string;
  entry: Pick<Entry, "location" | "name" | "isFolder">;
  /** Leave the extension out of the text selected at first. */
  skipExt: boolean;
}

export function RenameInput({ id, entry, skipExt }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = entry.name.lastIndexOf(".");
    el.setSelectionRange(0, skipExt && !entry.isFolder && dot > 0 ? dot : entry.name.length);
    // Select once, when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Told once: the blur that follows Enter or Escape is not a second end.
  const finish = (commit: boolean, byKey: boolean) => {
    const el = ref.current;
    if (done.current || !el) return;
    done.current = true;
    dispatch({ type: "rename.end", id, item: entry.location, name: commit ? el.value : null, refocus: byKey });
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
        if (isImeKey(e)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true, true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false, true);
        }
      }}
      onBlur={() => finish(true, false)}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    />
  );
}
