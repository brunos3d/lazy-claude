import React from 'react';
import { Box, Text } from 'ink';

interface ListViewProps<T> {
  items: T[];
  selectedIndex: number;
  /** Visible rows available for list content. */
  height: number;
  focused: boolean;
  /** Rendered lines per item. Two-line rows show a title plus a meta line. */
  linesPerItem?: number;
  renderItem: (item: T, selected: boolean, index: number) => React.ReactNode;
  emptyMessage: string;
}

/**
 * Scrollable list that keeps the selected row inside the visible window.
 * Items may render more than one line; the viewport maths use
 * `linesPerItem` so scrolling stays aligned to item boundaries.
 */
export function ListView<T>({
  items,
  selectedIndex,
  height,
  focused,
  linesPerItem = 1,
  renderItem,
  emptyMessage,
}: ListViewProps<T>) {
  if (items.length === 0) {
    return (
      <Box paddingX={1}>
        <Text dimColor>{emptyMessage}</Text>
      </Box>
    );
  }

  const visibleItems = Math.max(1, Math.floor(height / linesPerItem));
  let offset = 0;
  if (selectedIndex >= visibleItems) offset = selectedIndex - visibleItems + 1;
  offset = Math.min(offset, Math.max(0, items.length - visibleItems));
  const slice = items.slice(offset, offset + visibleItems);

  return (
    <Box flexDirection="column">
      {slice.map((item, i) => {
        const index = offset + i;
        return (
          <Box key={index} flexDirection="column">
            {renderItem(item, index === selectedIndex, index)}
          </Box>
        );
      })}
      {items.length > visibleItems ? (
        <Box paddingX={1}>
          <Text dimColor>
            {offset + 1}-{Math.min(offset + visibleItems, items.length)} of {items.length}
            {focused ? '' : ' '}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
