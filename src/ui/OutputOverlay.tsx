import React from 'react';
import { Box, Text } from 'ink';

interface OutputOverlayProps {
  title: string;
  body: string;
  width: number;
  height: number;
  scroll: number;
}

/** Fullscreen-ish overlay used to show raw Clamp output (verify, prune, info). */
export function OutputOverlay({ title, body, width, height, scroll }: OutputOverlayProps) {
  const innerHeight = Math.max(3, height - 6);
  const lines = body.replaceAll('\r', '').split('\n');
  const maxScroll = Math.max(0, lines.length - innerHeight);
  const offset = Math.min(scroll, maxScroll);
  const visible = lines.slice(offset, offset + innerHeight);

  return (
    <Box
      borderStyle="round"
      borderColor="magenta"
      flexDirection="column"
      paddingX={1}
      width={width}
      height={height}
    >
      <Text bold color="magenta">
        {title}
      </Text>
      <Box flexDirection="column" marginTop={1} height={innerHeight}>
        {visible.map((line, i) => (
          <Text key={i} wrap="truncate">
            {line || ' '}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {lines.length > innerHeight ? `↑/↓ scroll (${offset}/${maxScroll})  ` : ''}
          esc/q close
        </Text>
      </Box>
    </Box>
  );
}
