import React from 'react';
import { Box, Text } from 'ink';

/**
 * Inline search field shown above the contextual list. Typing is handled
 * by App so the same keystrokes can fall through to navigation when
 * search is closed.
 */
export function SearchBar({
  query,
  active,
  matches,
  total,
}: {
  query: string;
  active: boolean;
  matches: number;
  total: number;
}) {
  return (
    <Box paddingX={1}>
      <Text wrap="truncate">
        <Text color={active ? 'cyan' : undefined} bold>
          {active ? '/' : '⌕ '}
        </Text>
        <Text>{query}</Text>
        {active ? <Text inverse> </Text> : null}
        <Text dimColor>
          {'  '}
          {matches}/{total}
          {active ? '  (enter keep, esc clear)' : ''}
        </Text>
      </Text>
    </Box>
  );
}
