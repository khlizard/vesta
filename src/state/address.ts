// Folder names offered while a path is typed in an address bar.
// Spec: docs/spec/navigation.md「アドレスバー」

import { backend } from "../api/backend";
import { listableParent, matchingNames, splitTyped } from "../model/address";
import { compareNames } from "../model/sort";

const MAX_SUGGEST = 20;

export interface Suggestion {
  /** The typed text up to and including the last separator. */
  parent: string;
  /** Folder names under it that match what is typed after it. */
  names: string[];
}

export const NO_SUGGESTION: Suggestion = { parent: "", names: [] };

/**
 * Looks up suggestions for one address bar. It remembers the folders of the parent typed last,
 * so typing further letters does not list the folder again.
 */
export function createSuggester(): { suggest: (text: string) => Promise<Suggestion>; reset: () => void } {
  let cached: { parent: string; names: string[] } | null = null;

  const foldersIn = async (parent: string): Promise<string[]> => {
    if (cached?.parent.toLowerCase() === parent.toLowerCase()) return cached.names;
    try {
      const at = listableParent(parent);
      let location = at.path;
      if (at.resolve) {
        const r = await backend.resolveLocation(at.path);
        if (r.kind !== "folder") return [];
        location = r.folder.location;
      }
      const listing = await backend.listFolder(location, false);
      const names = listing.entries
        .filter((e) => e.isFolder)
        .map((e) => e.name)
        .sort(compareNames);
      cached = { parent, names };
      return names;
    } catch {
      // Not a folder that can be listed (yet): nothing to offer.
      return [];
    }
  };

  return {
    suggest: async (text) => {
      const typed = splitTyped(text);
      if (!typed) return NO_SUGGESTION;
      return { parent: typed.parent, names: matchingNames(await foldersIn(typed.parent), typed.prefix, MAX_SUGGEST) };
    },
    reset: () => {
      cached = null;
    },
  };
}
