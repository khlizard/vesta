// Menu labels as written in the settings files. Spec: docs/spec/config.md

/**
 * A label split around its access key: `ファイル(_F)` gives `ファイル(`, `F`, `)`. The `{*}`
 * marker is dropped. Without a `_` (or with one at the very end) the whole text is `before`.
 */
export function labelParts(text: string | undefined): { before: string; key: string; after: string } {
  const t = (text ?? "").replace("{*}", "");
  const i = t.indexOf("_");
  if (i < 0 || i === t.length - 1) return { before: t, key: "", after: "" };
  return { before: t.slice(0, i), key: t[i + 1], after: t.slice(i + 2) };
}

/** The label as plain text (for tooltips), and the access key in lower case. */
export function menuLabel(text: string | undefined): { label: string; accessKey: string | null } {
  const { before, key, after } = labelParts(text);
  return { label: before + key + after, accessKey: key ? key.toLowerCase() : null };
}
