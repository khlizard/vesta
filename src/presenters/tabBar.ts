// What the tab bar draws. Spec: docs/spec/tabs.md

import { computeLabels } from "../model/labels";
import { presenter } from "./view";

export interface TabView {
  id: string;
  label: string;
  title: string;
  /** Its pane is on screen. */
  shown: boolean;
  /** It is the tab commands act on. */
  current: boolean;
  locked: boolean;
}

/** The tabs, in the order they stand in the bar. */
export const tabBarView = presenter(
  (s) => [s.app.tabs, s.app.options.DistinguishTab] as const,
  (tabs, distinguish): TabView[] => {
    const labels = computeLabels(tabs.tabs, distinguish);
    return tabs.tabs.map((t) => ({
      id: t.id,
      label: labels.get(t.id) ?? t.displayName,
      title: t.fsPath ?? t.displayName,
      shown: t.shown,
      current: t.id === tabs.currentId,
      locked: t.locked,
    }));
  },
);
