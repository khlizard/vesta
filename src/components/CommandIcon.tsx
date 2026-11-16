// The icon of a menu / tool bar / status bar item (`image` number). Spec: docs/spec/config.md「image の番号」
import { COMMAND_ICONS } from "../config/icons";

interface Props {
  index: number;
  /** 24 for the tool bar, 16 for menus and the status bar. */
  size: number;
  disabled?: boolean;
}

/** SVG icon for `index`; an empty box of the same size for numbers without an icon. */
export function CommandIcon({ index, size, disabled }: Props) {
  const Icon = COMMAND_ICONS[index];
  const cls = disabled ? "cmd-icon disabled" : "cmd-icon";
  if (!Icon) return <span className={cls} style={{ width: size, height: size }} />;
  return <Icon className={cls} size={size} strokeWidth={size > 16 ? 1.75 : 2} aria-hidden="true" />;
}
