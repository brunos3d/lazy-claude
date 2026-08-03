import React from 'react';
import { Box, Text } from 'ink';
import { useTerminalSize } from '../useTerminalSize.js';

/**
 * Base overlay frame.
 *
 * The modal is absolutely positioned over the whole viewport and centred,
 * so the application stays mounted and visible behind it. Ink composites
 * later siblings over earlier ones, which gives the z-order.
 *
 * Every interior line is painted as a full-width Text with a background
 * colour. Box padding would leave transparent gaps and the UI underneath
 * would show through the dialog, so lines carry their own padding.
 */

export interface Segment {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
  inverse?: boolean;
}

const BACKGROUND = 'black';

/** One opaque row of a modal, padded to the modal's interior width. */
export function ModalLine({ segments, width }: { segments: Segment[]; width: number }) {
  const used = segments.reduce((total, segment) => total + segment.text.length, 0);
  const padding = Math.max(0, width - used);
  return (
    <Text backgroundColor={BACKGROUND} wrap="truncate">
      {segments.map((segment, index) => (
        <Text
          key={index}
          color={segment.color}
          bold={segment.bold}
          dimColor={segment.dim}
          inverse={segment.inverse}
        >
          {segment.text}
        </Text>
      ))}
      {' '.repeat(padding)}
    </Text>
  );
}

/** Convenience for a plain, single-style line. */
export function textLine(text: string, width: number, style: Omit<Segment, 'text'> = {}) {
  return <ModalLine width={width} segments={[{ text: `  ${text}`, ...style }]} />;
}

export function blankLine(width: number) {
  return <ModalLine width={width} segments={[]} />;
}

/** Soft-wrap a paragraph to the interior width, preserving explicit breaks. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of paragraph.split(' ')) {
      if (current && current.length + word.length + 1 > width) {
        lines.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

export function Modal({
  borderColor = 'cyan',
  width,
  children,
}: {
  borderColor?: string;
  /** Interior width in columns, excluding the border. */
  width: number;
  children: React.ReactNode;
}) {
  const { columns, rows } = useTerminalSize();
  return (
    <Box
      position="absolute"
      width={columns}
      height={rows}
      alignItems="center"
      justifyContent="center"
    >
      <Box flexDirection="column" borderStyle="double" borderColor={borderColor} width={width + 2}>
        {children}
      </Box>
    </Box>
  );
}

/** Interior width that fits the terminal, for dialogs sizing themselves. */
export function useModalWidth(preferred: number): number {
  const { columns } = useTerminalSize();
  return Math.max(24, Math.min(preferred, columns - 8));
}
