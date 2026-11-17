// What a pane's address bar draws. Spec: docs/spec/navigation.md「アドレスバー」

import { iconUrl } from "../api/urls";
import { presenter, type Presenter } from "./view";

export interface AddressBarView {
  /** False until the pane shows a folder: no icon then. */
  hasFolder: boolean;
  /** The folder as text: its path, or its name when it has none. */
  text: string;
  iconSrc: string | null;
  current: boolean;
  /** Folder names offered for the path being typed here: `parent + name` is the path of each. */
  suggest: { parent: string; names: string[] } | null;
  /** Changes (to something other than 0) when the field is asked to take the focus. */
  focusSeq: number;
}

/** The presenter of the address bar of pane `id`. Make it once per id (`useMemo`). */
export function addressBarView(id: string): Presenter<AddressBarView> {
  return presenter(
    (s) => {
      const { suggest, focus } = s.app;
      return [
        s.app.panes[id]?.folder ?? null,
        s.app.tabs.currentId === id,
        suggest?.paneId === id ? suggest : null,
        focus?.paneId === id && focus.target === "address" ? focus.seq : 0,
      ] as const;
    },
    (folder, current, suggest, focusSeq): AddressBarView => ({
      hasFolder: folder !== null,
      text: folder?.fsPath ?? folder?.displayName ?? "",
      // Inside a cloud sync root (Dropbox, OneDrive...): the root's icon.
      iconSrc: folder ? iconUrl(folder.syncRootPath ?? folder.location) : null,
      current,
      suggest: suggest && suggest.names.length ? { parent: suggest.parent, names: suggest.names } : null,
      focusSeq,
    }),
  );
}
