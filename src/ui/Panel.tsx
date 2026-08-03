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

export function Panel({ title, focused, width, height, flexGrow, children }: PanelProps) {
  return (
    <Box
      borderStyle="round"
      borderColor={focused ? 'green' : 'gray'}
      flexDirection="column"
      width={width}
      height={height}
      flexGrow={flexGrow}
    >
      <Box paddingX={1}>
        <Text bold color={focused ? 'green' : 'white'}>
          {title}
        </Text>
      </Box>
      {children}
    </Box>
  );
}
