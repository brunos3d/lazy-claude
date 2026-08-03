import React from 'react';
import { Box, Text } from 'ink';

interface ListViewProps<T> {
  items: T[];
  selectedIndex: number;
  /** Visible rows available for list items. */
  height: number;
  focused: boolean;
  renderItem: (item: T, selected: boolean, width: number) => React.ReactNode;
  width: number;
  emptyMessage: string;
}

/** Scrollable list that keeps the selected row inside the visible window. */
export function ListView<T>({
  items,
  selectedIndex,
  height,
  focused,
  renderItem,
  width,
  emptyMessage,
}: ListViewProps<T>) {
  if (items.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>{emptyMessage}</Text>
      </Box>
    );
  }

  const visible = Math.max(1, height);
  let offset = 0;
  if (selectedIndex >= visible) {
    offset = selectedIndex - visible + 1;
  }
  offset = Math.min(offset, Math.max(0, items.length - visible));
  const slice = items.slice(offset, offset + visible);

  return (
    <Box flexDirection="column">
      {slice.map((item, i) => {
        const index = offset + i;
        const selected = index === selectedIndex;
        return (
          <Box key={index} paddingX={1}>
            <Text
              backgroundColor={selected && focused ? 'blue' : undefined}
              color={selected && !focused ? 'blue' : undefined}
              wrap="truncate"
            >
              {renderItem(item, selected, width)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
