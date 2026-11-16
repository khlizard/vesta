// Pane width fractions. Spec: docs/spec/tabs.md「ペインの配置」

export function resolveFractions(ids: string[], saved: Record<string, number> | null): number[] {
  const equal = ids.map(() => 1 / Math.max(1, ids.length));
  if (!saved) return equal;
  const f = ids.map((id) => saved[id]);
  if (f.some((x) => !(x > 0))) return equal;
  const sum = f.reduce((a, b) => a + b, 0);
  return f.map((x) => x / sum);
}

/** Moves the border between panes i and i+1 by `dx` (a fraction of the total), keeping both at least `minFrac`. */
export function resizePair(f: number[], i: number, dx: number, minFrac: number): number[] {
  if (i < 0 || i + 1 >= f.length) return f;
  const total = f[i] + f[i + 1];
  const min = Math.min(minFrac, total / 2);
  const a = Math.min(Math.max(f[i] + dx, min), total - min);
  const out = f.slice();
  out[i] = a;
  out[i + 1] = total - a;
  return out;
}
