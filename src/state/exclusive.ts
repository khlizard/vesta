// File operations run one at a time (model/gate.ts). Spec: docs/spec/ui.md「処理中の操作」

import { admit, entered, left } from "../model/gate";
import { setMessage } from "./message";
import { getState, setState } from "./store";

/** Starts the operation that is waiting for the running one to end. */
let startWaiting: (() => void) | null = null;

/**
 * Runs `work` when no other exclusive work is running. One call may wait for its turn; while
 * one is already waiting, further calls are dropped with a note in the status bar and resolve
 * to undefined.
 */
export async function exclusive<T>(work: () => Promise<T>): Promise<T | undefined> {
  const gate = getState().gate;
  const admission = admit(gate, "exclusive", false);
  if (admission === "drop") {
    setMessage("前の操作が終わるまで待ってください", 2000);
    return undefined;
  }
  setState({ gate: entered(gate, admission, "exclusive") });
  if (admission === "wait") await new Promise<void>((start) => (startWaiting = start));
  try {
    return await work();
  } finally {
    const after = left(getState().gate);
    setState({ gate: after.gate });
    if (after.next) {
      const start = startWaiting;
      startWaiting = null;
      start?.();
    }
  }
}

/**
 * True when the app may close or restart now: no copy / move / delete is running, or the user
 * agreed to stop it (an unfinished copy leaves partial files at the destination).
 */
export function mayClose(ask: (message: string) => boolean = (m) => window.confirm(m)): boolean {
  if (!getState().gate.running) return true;
  return ask(
    "ファイルの操作（コピー・移動・削除）がまだ終わっていません。\n終了すると途中で止まります。終了しますか？",
  );
}
