// Automatic updates (Velopack). Spec: docs/spec/update.md

import { backend } from "../api/backend";
import { errorText } from "../model/input";
import { flushState, setMessage } from "./actions";
import { mayClose } from "./busy";
import { getState, setState } from "./store";

const FIRST_CHECK_MS = 5_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let started = false;

async function check() {
  if (getState().updateReady) return;
  // Offline, rate-limited, not installed by Velopack...: stay quiet and try again next time.
  const version = await backend.updateCheck().catch(() => null);
  if (version) setState({ updateReady: version });
}

/** Checks shortly after startup and then periodically; a downloaded update shows in the status bar. */
export function startUpdateChecks() {
  if (started) return;
  started = true;
  setTimeout(() => void check(), FIRST_CHECK_MS);
  setInterval(() => void check(), CHECK_EVERY_MS);
}

/** `System.Update`: saves tabs and settings, then applies the update and restarts. */
export async function restartForUpdate() {
  if (!getState().updateReady || !mayClose()) return;
  await flushState();
  try {
    await backend.updateRestart();
  } catch (e) {
    setMessage(`更新できませんでした: ${errorText(e)}`);
  }
}
