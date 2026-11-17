// The transient message in the status bar.

import { setState } from "./store";

let timer: ReturnType<typeof setTimeout> | undefined;

/** Shows a transient message in the status bar. */
export function setMessage(text: string | null, ms = 5000) {
  clearTimeout(timer);
  setState({ message: text });
  if (text) timer = setTimeout(() => setState({ message: null }), ms);
}
