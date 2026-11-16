// Formatting for the list and the status bar. Spec: docs/spec/listing.md

const UNITS = ["KB", "MB", "GB", "TB", "PB"];

/** Like StrFormatByteSize: "0 バイト", "1.23 KB", "45.6 MB", "789 GB" (3 significant digits, truncated). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} バイト`;
  let v = n / 1024;
  let u = 0;
  while (v >= 1000 && u < UNITS.length - 1) {
    v /= 1024;
    u++;
  }
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  const f = 10 ** digits;
  const t = Math.floor(v * f) / f;
  return `${t.toFixed(digits)} ${UNITS[u]}`;
}

/** Size column like Explorer: "1,234 KB" (rounded up to KB, "0 KB" for empty files). */
export function formatSizeColumn(n: number | null): string {
  if (n === null) return "";
  const kb = Math.ceil(n / 1024);
  return `${kb.toLocaleString("en-US")} KB`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "yyyy/MM/dd HH:mm" in local time. */
export function formatDate(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// FILE_ATTRIBUTE_* flags and their letters, in Explorer's order.
const ATTRIBUTE_LETTERS: [number, string][] = [
  [0x1, "R"], // READONLY
  [0x2, "H"], // HIDDEN
  [0x4, "S"], // SYSTEM
  [0x10, "D"], // DIRECTORY
  [0x20, "A"], // ARCHIVE
  [0x800, "C"], // COMPRESSED
  [0x4000, "E"], // ENCRYPTED
];

/** Attribute column like Explorer: "RHSDACE" letters of the set flags ("" when unknown). */
export function formatAttributes(attrs: number | null): string {
  if (attrs === null) return "";
  return ATTRIBUTE_LETTERS.filter(([bit]) => attrs & bit)
    .map(([, ch]) => ch)
    .join("");
}

export interface StatusInput {
  total: number;
  totalBytes: number;
  selected: number;
  selectedBytes: number;
  /** Free space of the volume; null for virtual folders. */
  disk: { label: string; free: number } | null;
}

/** Status bar text for the current pane. */
export function statusText(s: StatusInput): string {
  if (s.selected > 0) {
    return `${s.selected} / ${s.total} 個のオブジェクトを選択 ( ${formatBytes(s.selectedBytes)} )`;
  }
  if (s.disk) {
    return `${s.total} 個のオブジェクト ( ${formatBytes(s.totalBytes)} ) / 空きディスク領域 [${s.disk.label}] ${formatBytes(s.disk.free)}`;
  }
  return `${s.total} 個のオブジェクト`;
}
