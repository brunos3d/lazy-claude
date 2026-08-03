import React from 'react';
import { Box, Text } from 'ink';

/**
 * Tab navigation for a panel header.
 *
 * The active tab is painted as a filled button and the inactive ones sit
 * at low contrast, so the row reads as navigation rather than as a line
 * of body text. Colour roles are deliberate: green stays reserved for
 * titles and status elsewhere in the app, so tabs use blue and grey.
 *
 * A rule underneath separates the navigation from the content below,
 * which is what gives the panel its hierarchy without nesting borders.
 */

export interface TabDef<Id extends string = string> {
  id: Id;
  label: string;
}

/** Columns a tab occupies, including its number prefix and padding. */
export function tabWidth(tab: TabDef, index: number): number {
  return ` ${index + 1} ${tab.label} `.length;
}

/**
 * Screen ranges of each tab within the bar, for click hit-testing. The
 * offsets are relative to the first column of the bar.
 */
export function tabRanges(tabs: readonly TabDef[], gap = 1): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let x = 0;
  tabs.forEach((tab, index) => {
    const width = tabWidth(tab, index);
    ranges.push({ start: x, end: x + width - 1 });
    x += width + gap;
  });
  return ranges;
}

function Tab({ tab, index, active }: { tab: TabDef; index: number; active: boolean }) {
  return (
    <Text
      backgroundColor={active ? 'blue' : undefined}
      color={active ? 'white' : 'gray'}
      bold={active}
      dimColor={!active}
    >
      {` ${index + 1} ${tab.label} `}
    </Text>
  );
}

export function TabBar<Id extends string>({
  tabs,
  active,
  width,
  gap = 1,
}: {
  tabs: readonly TabDef<Id>[];
  active: Id;
  /** Interior width of the host panel, used for the separator rule. */
  width: number;
  gap?: number;
}) {
  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        {tabs.map((tab, index) => (
          <React.Fragment key={tab.id}>
            {index > 0 ? <Text>{' '.repeat(gap)}</Text> : null}
            <Tab tab={tab} index={index} active={tab.id === active} />
          </React.Fragment>
        ))}
      </Box>
      <Box paddingX={1}>
        <Text dimColor color="gray">
          {'─'.repeat(Math.max(0, width))}
        </Text>
      </Box>
    </Box>
  );
}
