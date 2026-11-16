// Current.New: what to create from the typed name. Spec: docs/spec/fileops.md

/** A file when the name has an extension (something after the last "."), else a folder; null when empty. */
export function newItemKind(name: string): "file" | "folder" | null {
  const n = name.trim();
  if (!n) return null;
  return /\.[^.\\/]+$/.test(n) ? "file" : "folder";
}
