// Text size (config.json FontSize). Spec: docs/spec/ui.md「見た目」

export const FONT_SIZES = [11, 12, 14, 16] as const;
export const DEFAULT_FONT_SIZE = 12;

/** A saved value, or the default when it is not one of FONT_SIZES. */
export function normalizeFontSize(v: unknown): number {
  return (FONT_SIZES as readonly unknown[]).includes(v) ? (v as number) : DEFAULT_FONT_SIZE;
}

/** Heights (px) that follow the text size; at 12px they are the original fixed values. */
export function textMetrics(fontSize: number) {
  const line = fontSize + 8; // 20 at 12px: menu items, tabs, link buttons, detail rows
  const labelLine = fontSize + 3; // 15 at 12px: one line of a thumbnail label
  return {
    line,
    labelLine,
    /** Detail rows and the details header. */
    row: line,
    /** Two label lines plus padding under a thumbnail. */
    thumbLabel: labelLine * 2 + 2,
    /** Group headers. */
    group: line + 2,
  };
}

/**
 * Column widths after the text size changes from `from` to `to`: text columns grow or shrink
 * with the text; `status` holds icons only and keeps its width.
 */
export function scaleWidths<K extends string>(widths: Record<K, number>, from: number, to: number): Record<K, number> {
  if (from === to || from <= 0) return { ...widths };
  const out = { ...widths };
  for (const k of Object.keys(out) as K[]) {
    if (k !== "status") out[k] = Math.round(out[k] * (to / from));
  }
  return out;
}
