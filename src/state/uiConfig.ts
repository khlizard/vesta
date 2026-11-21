// Loads usr/*.xml through the backend into the settings store. Spec: docs/spec/config.md
// Which commands exist is passed in (`isKnown`): the command table sits above this layer.

import { backend } from "../api/backend";
import { pruneConfig, unknownCommands, type IsKnown } from "../config/prune";
import { useConfig } from "../config/store";
import { errorText } from "../model/input";
import { logLine } from "./log";
import { setMessage } from "./message";

/** Loads the settings. Returns the unknown command names (items using them are left out). */
export async function loadUiConfig(isKnown: IsKnown): Promise<string[]> {
  try {
    const r = await backend.uiConfig();
    useConfig.setState(pruneConfig(r.config, isKnown));
    for (const w of r.warnings) logLine(w);
    if (r.warnings.length) setMessage(`設定ファイルの一部を読めませんでした: ${r.warnings[0]}`);
    const unknown = unknownCommands(r.config, isKnown);
    if (unknown.length) logLine(`unknown commands in usr/*.xml: ${unknown.join(", ")}`);
    return unknown;
  } catch (e) {
    // The backend answers with the built-in settings even when usr/ cannot be used, so this
    // only happens if the call itself fails; the window then has no menus until a reload works.
    logLine("get_ui_config failed", e);
    setMessage(`設定ファイルを読めませんでした: ${errorText(e)}`);
    return [];
  }
}

/** `Option.Reload`: reads usr/*.xml again and says how it went. */
export async function reloadUiConfig(isKnown: IsKnown) {
  const unknown = await loadUiConfig(isKnown);
  // At startup unknown commands are only logged (settings copied from Avesta have many).
  // After a reload the user has just edited a file, so a mistyped name is worth showing.
  if (unknown.length) {
    setMessage(
      `設定ファイルを読み直しました。使えないコマンド ${unknown.length} 件：${unknown.slice(0, 3).join("、")}${unknown.length > 3 ? " ほか" : ""}`,
      8000,
    );
  } else {
    setMessage("設定ファイルを読み直しました", 2000);
  }
}
