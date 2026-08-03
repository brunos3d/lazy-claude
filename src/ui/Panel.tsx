import React from 'react';
import { Box, Text } from 'ink';

interface PanelProps {
  title: string;
  focused: boolean;
  width?: number;
  height?: number;
  flexGrow?: number;
  children: React.ReactNode;
}

/**
 * Bordered panel with a focus-coloured title. `flexShrink` is pinned to 0
 * so a panel given an explicit width keeps it: Yoga shrinks fixed-width
 * children by default, which otherwise squeezes the list column.
 */
export function Panel({ title, focused, width, height, flexGrow, children }: PanelProps) {
  return (
    <Box
      borderStyle="round"
      borderColor={focused ? 'green' : 'gray'}
      flexDirection="column"
      width={width}
      height={height}
      flexGrow={flexGrow}
      flexShrink={width === undefined ? 1 : 0}
      overflow="hidden"
    >
      <Box paddingX={1}>
        <Text bold color={focused ? 'green' : 'white'} wrap="truncate">
          {title}
        </Text>
      </Box>
      {children}
    </Box>
  );
}
