// File operations in progress, so closing the window can ask first. Spec: docs/spec/fileops.md

let running = 0;

export function beginFileOp() {
  running++;
}

export function endFileOp() {
  running = Math.max(0, running - 1);
}

/**
 * True when the app may close or restart now: no copy / move / delete is running, or the user
 * agreed to stop it (an unfinished copy leaves partial files at the destination).
 */
export function mayClose(ask: (message: string) => boolean = (m) => window.confirm(m)): boolean {
  if (running === 0) return true;
  return ask("ファイルの操作（コピー・移動・削除）がまだ終わっていません。\n終了すると途中で止まります。終了しますか？");
}
