// Handles the verbs the native context menu hands back to the app.

import { backend } from "../../api/backend";
import { beginRename, bury, copyOrCut, paste, properties, recycle } from "../../state/fileActions";

export async function runMenuVerb(id: string, verb: string | null) {
  switch (verb) {
    case "rename":
      beginRename(id);
      break;
    case "delete":
      if ((await backend.keyState()).shift) await bury(id);
      else await recycle(id);
      break;
    case "cut":
      await copyOrCut(id, true);
      break;
    case "copy":
      await copyOrCut(id, false);
      break;
    case "paste":
      await paste(id);
      break;
    case "properties":
      await properties(id);
      break;
  }
}
