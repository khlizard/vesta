// The build time shown in the About dialog. Spec: docs/spec/ui.md「バージョン情報」

const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-11-11 11:40` in local time; "" when `iso` is not a date. */
export function formatBuildTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
