// Completing a path typed in the address bar. Spec: docs/spec/navigation.md「アドレスバー」

/** Splits typed text into the parent to list and the name prefix, or null when there is no `\` or `/`. */
export function splitTyped(text: string): { parent: string; prefix: string } | null {
  const i = Math.max(text.lastIndexOf("\\"), text.lastIndexOf("/"));
  if (i < 0) return null;
  return { parent: text.slice(0, i + 1), prefix: text.slice(i + 1) };
}

/** The first `max` of `names` that start with `prefix`, ignoring case. */
export function matchingNames(names: string[], prefix: string, max: number): string[] {
  const lower = prefix.toLowerCase();
  return names.filter((n) => n.toLowerCase().startsWith(lower)).slice(0, max);
}

/**
 * How a typed parent has to be handed to the folder listing: with `\` for `/`. `resolve` is
 * true when it starts at `~`, which the listing does not understand and must be resolved first.
 */
export function listableParent(parent: string): { path: string; resolve: boolean } {
  const path = parent.replace(/\//g, "\\");
  return { path, resolve: path.startsWith("~\\") };
}
