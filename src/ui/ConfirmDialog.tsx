import React from 'react';
import { Box, Text } from 'ink';

interface ConfirmDialogProps {
  title: string;
  message: string;
  danger: boolean;
}

/**
 * Modal confirmation box. Input handling lives in App so there is a single
 * keyboard owner; this component is purely presentational.
 */
export function ConfirmDialog({ title, message, danger }: ConfirmDialogProps) {
  return (
    <Box
      borderStyle="double"
      borderColor={danger ? 'red' : 'yellow'}
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      alignSelf="center"
    >
      <Text bold color={danger ? 'red' : 'yellow'}>
        {title}
      </Text>
      <Box marginTop={1} width={60}>
        <Text wrap="wrap">{message}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>
          <Text bold color="green">
            y
          </Text>
          <Text> confirm  </Text>
          <Text bold color="red">
            n/esc
          </Text>
          <Text> cancel</Text>
        </Text>
      </Box>
    </Box>
  );
}
