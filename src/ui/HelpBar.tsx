import React from 'react';
import { Box, Text } from 'ink';

interface HelpBarProps {
  bindings: Array<[key: string, label: string]>;
  status?: string;
}

export function HelpBar({ bindings, status }: HelpBarProps) {
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Text wrap="truncate">
        {bindings.map(([key, label], i) => (
          <Text key={key}>
            {i > 0 ? '  ' : ''}
            <Text bold color="cyan">
              {key}
            </Text>
            <Text dimColor> {label}</Text>
          </Text>
        ))}
      </Text>
      {status ? <Text color="yellow">{status}</Text> : null}
    </Box>
  );
}
