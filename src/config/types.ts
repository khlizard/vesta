// Bar and key configuration (the parsed form of Avesta's usr/*.xml). Spec: docs/spec/config.md

export interface MenuItem {
  /** Display text. `_X` marks the access key. Absent/empty with no other fields = separator. */
  text?: string;
  command?: string;
  /** Location to open (menu.xml `navigate`). */
  navigate?: string;
  /** Program to run (`execute`) with `args`. */
  execute?: string;
  args?: string;
  /** Index into the icon strip (menu.png / tool.png / status.png). */
  image?: number;
  /** link.xml only. */
  path?: string;
  depth?: number;
  includeFiles?: boolean;
  separator?: boolean;
  children?: MenuItem[];
}

export interface KeyBinding {
  /** Any of "C", "S", "A", "W". */
  modifier: string;
  /** Avesta key name (`F2`, `backspace`, `←`, `A`, `,`). */
  key: string;
  item: MenuItem;
}

export interface UiConfig {
  menu: MenuItem[];
  tool: MenuItem[];
  status: MenuItem[];
  link: MenuItem[];
  keyForm: KeyBinding[];
  keyFolder: KeyBinding[];
}
