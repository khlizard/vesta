// Problems that do not stop the app: a line in var/vesta.log, and for the user's own files a
// message in the status bar. Spec: docs/spec/config.md「置き場所」

import { backend } from "../api/backend";
import { errorText } from "../model/input";
import { setMessage } from "./message";

/** Writes a line to var/vesta.log (a release build has no console to warn on). */
export function logLine(text: string, error?: unknown) {
  const line = error === undefined ? text : `${text}: ${errorText(error)}`;
  if (import.meta.env.DEV) console.warn(line);
  void backend.logLine(line).catch(() => {});
}

/** For `.catch`: a state file (config.json...) could not be written. */
export const saveFailed = (file: string) => (e: unknown) => {
  logLine(`${file} could not be saved`, e);
  setMessage(`${file} を保存できません: ${errorText(e)}`);
};

/**
 * A state file could not be read as what it should be: it is set aside as `<name>.bad.json`
 * so the next save does not overwrite it, and the user is told. The app goes on with defaults.
 */
export async function setAsideBadState(name: string, what: string) {
  logLine(`${name}.json could not be read; kept as ${name}.bad.json`);
  await backend.keepBadState(name).catch((e) => logLine(`${name}.json could not be set aside`, e));
  setMessage(
    `${what}（${name}.json）を読めませんでした。既定の状態で始めます。元のファイルは ${name}.bad.json に残しました`,
    15000,
  );
}

/**
 * Runs one step of startup. A step that fails is logged and the next one still runs: a damaged
 * file or an unreachable folder must not leave the window empty or keep saving from working.
 */
export async function startupStep(what: string, f: () => unknown): Promise<void> {
  try {
    await f();
  } catch (e) {
    logLine(`startup: ${what}`, e);
  }
}
