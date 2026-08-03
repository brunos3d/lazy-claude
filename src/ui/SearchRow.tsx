import React from 'react';
import { Box, Text } from 'ink';

/**
 * Search affordance pinned to the top of a list panel.
 *
 * It is always visible, so search is discoverable without reading the
 * help, but typing only enters the query once `/` has been pressed. That
 * keeps the single-key action shortcuts (a, d, m, p, ...) usable while
 * moving through a list.
 */
export function SearchRow({
  active,
  query,
  placeholder,
  matches,
  total,
  width,
  sort,
}: {
  active: boolean;
  query: string;
  placeholder: string;
  matches: number;
  total: number;
  width: number;
  /** Current sort, shown on the right so the order is never a mystery. */
  sort?: string;
}) {
  const filtering = query.length > 0;
  const counter = filtering ? `${matches}/${total}` : String(total);
  // Dropped entirely on a narrow panel rather than truncated: half a sort
  // name reads as a rendering fault, a missing one reads as no room.
  const badge = sort && width >= 28 ? `↕ ${sort}` : '';

  return (
    <Box paddingX={1}>
      <Text wrap="truncate">
        <Text color={active ? 'cyan' : filtering ? 'yellow' : undefined} bold={active || filtering}>
          {'⌕ '}
        </Text>
        {query ? (
          <Text color={active ? 'white' : undefined}>{query}</Text>
        ) : (
          <Text dimColor>{active ? '' : placeholder}</Text>
        )}
        {active ? <Text inverse> </Text> : null}
        <Text dimColor>
          {'  '}
          {counter}
          {active ? '  esc clear, enter keep' : filtering ? '  esc clear' : ''}
        </Text>
      </Text>
      <Box flexGrow={1} />
      {badge ? (
        <Text dimColor wrap="truncate">
          {badge}
        </Text>
      ) : null}
      <Text> </Text>
    </Box>
  );
}
