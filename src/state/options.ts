// Options (config.json). Spec: docs/spec/config.md「config.json のオプション」

import { backend } from "../api/backend";
import { scaleWidths } from "../model/fontSize";
import { normalizeOptions } from "../model/options";
import { DEFAULT_OPTIONS, getState, setState, type Options } from "./store";

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Writes config.json shortly after the last change (column drags and Ctrl+wheel change options rapidly). */
function saveOptionsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveOptions(), 500);
}

/** Writes config.json now (before a restart). */
export async function saveOptions() {
  clearTimeout(saveTimer);
  await backend.writeState("config", JSON.stringify(getState().options)).catch(() => {});
}

export async function setOption<K extends keyof Options>(key: K, value: Options[K]) {
  setState((s) => ({ options: { ...s.options, [key]: value } }));
  saveOptionsSoon();
}

/** `Option.FontSize.N`: changes the text size; column widths follow it (docs/spec/ui.md「見た目」). */
export async function setFontSize(size: number) {
  const { FontSize, ColumnWidths } = getState().options;
  if (size === FontSize) return;
  setState((s) => ({ options: { ...s.options, FontSize: size, ColumnWidths: scaleWidths(ColumnWidths, FontSize, size) } }));
  saveOptionsSoon();
}

export async function loadOptions() {
  const raw = await backend.readState("config").catch(() => null);
  if (!raw) return;
  try {
    setState({ options: normalizeOptions(JSON.parse(raw), DEFAULT_OPTIONS) });
  } catch {
    /* keep defaults */
  }
}