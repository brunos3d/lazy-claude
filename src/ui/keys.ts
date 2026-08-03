import type { Key } from 'ink';

/**
 * Global keybindings, in one place so rebinding is a one-line change and
 * the footer label can never drift from what the handler actually accepts.
 */
export interface Binding {
  /** Shown in the footer and the help text. */
  label: string;
  matches: (input: string, key: Key) => boolean;
}

export const KEYS = {
  /**
   * Ink reports ctrl+k as input "k" with key.ctrl set. 0x0B is unclaimed
   * by terminal line discipline in raw mode, so nothing else wants it.
   *
   * The handler in App must test this before its vim-style navigation,
   * which treats a bare "k" as "move up" without checking key.ctrl.
   */
  commandPalette: {
    label: 'ctrl+k',
    matches: (input, key) => key.ctrl && input === 'k',
  },
} satisfies Record<string, Binding>;
