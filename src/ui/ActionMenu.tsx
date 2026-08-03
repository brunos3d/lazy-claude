import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface Action {
  /** Single-key shortcut that also works outside the menu. */
  key: string;
  label: string;
  description: string;
  run: () => void;
  /** Disabled actions stay visible so the menu doubles as documentation. */
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
}

/**
 * Contextual action palette, opened with `x`. It lists every operation
 * available for the current selection, which keeps new features
 * discoverable without memorizing shortcuts.
 */
export function ActionMenu({
  title,
  actions,
  active,
  onClose,
}: {
  title: string;
  actions: Action[];
  active: boolean;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const enabled = actions.filter((a) => !a.disabled);

  useInput(
    (input, key) => {
      if (key.escape || input === 'q') {
        onClose();
        return;
      }
      if (key.upArrow || input === 'k') {
        setIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow || input === 'j') {
        setIndex((i) => Math.min(actions.length - 1, i + 1));
        return;
      }
      if (key.return) {
        const action = actions[index];
        if (action && !action.disabled) {
          onClose();
          action.run();
        }
        return;
      }
      const direct = enabled.find((a) => a.key === input);
      if (direct) {
        onClose();
        direct.run();
      }
    },
    { isActive: active },
  );

  const width = 68;

  return (
    <Box borderStyle="double" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="cyan">
        {title}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {actions.map((action, i) => {
          const selected = i === index;
          return (
            <Text key={action.key + action.label} wrap="truncate" dimColor={action.disabled}>
              <Text color={selected && !action.disabled ? 'green' : undefined}>
                {selected ? '❯ ' : '  '}
              </Text>
              <Text bold color={action.disabled ? undefined : action.danger ? 'red' : 'cyan'}>
                {action.key.padEnd(6)}
              </Text>
              <Text>{action.label.padEnd(24).slice(0, 24)}</Text>
              <Text dimColor>
                {(action.disabled ? (action.disabledReason ?? 'unavailable') : action.description).slice(
                  0,
                  width - 34,
                )}
              </Text>
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>enter run, shortcut key runs directly, esc close</Text>
      </Box>
    </Box>
  );
}
