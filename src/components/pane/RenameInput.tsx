// In-place rename editor. Spec: docs/spec/fileops.md

import { useEffect, useRef } from "react";
import { renameSelection, type RenamePart } from "../../model/fileOps";
import { isImeKey } from "../../model/input";
import type { Entry } from "../../presenters/list";
import { dispatch } from "../../root/dispatch";

interface Props {
  id: string;
  entry: Pick<Entry, "location" | "name" | "isFolder">;
  /** The part of the name to select: when the box opens, and again whenever this changes. */
  part: RenamePart;
}

export function RenameInput({ id, entry, part }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Of the text as it is now: what was typed so far stays.
    el.setSelectionRange(...renameSelection(el.value, entry.isFolder, part));
  }, [part, entry.isFolder]);

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
