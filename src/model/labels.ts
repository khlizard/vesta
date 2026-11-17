// Tab labels with DistinguishTab. Spec: docs/spec/tabs.md「ラベル」

import { sameLocation } from "./paths";

export interface LabelSource {
  id: string;
  location: string;
  displayName: string;
  fsPath: string | null;
}

/**
 * The title of the window: `Vesta - {name} / {path}` for the current tab, `Vesta` without one.
 * `folder` is what the tab's pane has loaded; until then the tab's own name and location stand in.
 * Spec: docs/spec/ui.md「ウィンドウ」
 */
export function windowTitle(
  tab: { displayName: string; location: string } | null,
  folder: { displayName: string; fsPath: string | null } | null,
): string {
  if (!tab) return "Vesta";
  return `Vesta - ${folder?.displayName ?? tab.displayName} / ${folder?.fsPath ?? folder?.displayName ?? tab.location}`;
}

function parts(src: LabelSource): string[] | null {
  if (!src.fsPath) return null;
  const p = src.fsPath.replace(/\\+$/, "");
  if (p.startsWith("\\\\")) {
    return p.slice(2).split("\\").filter(Boolean).map((s, i) => (i === 0 ? `\\\\${s}` : s));
  }
  return p.split("\\").filter(Boolean);
}

function suffix(ps: string[], n: number): string {
  return ps.slice(Math.max(0, ps.length - n)).join("\\");
}

/** Returns a label for every tab id. */
export function computeLabels(tabs: LabelSource[], distinguish: boolean): Map<string, string> {
  const result = new Map<string, string>();
  const split = tabs.map((t) => ({ t, ps: parts(t) }));
  for (const { t, ps } of split) {
    if (!ps || ps.length === 0) {
      result.set(t.id, t.displayName);
      continue;
    }
    if (!distinguish) {
      result.set(t.id, ps[ps.length - 1]);
      continue;
    }
    const others = split.filter(
      (o) => o.t.id !== t.id && o.ps && !sameLocation(o.t.location, t.location),
    );
    let n = 1;
    while (n < ps.length) {
      const mine = suffix(ps, n).toLowerCase();
      const clash = others.some((o) => o.ps && suffix(o.ps, n).toLowerCase() === mine);
      if (!clash) break;
      n++;
    }
    result.set(t.id, suffix(ps, n));
  }
  return result;
}
