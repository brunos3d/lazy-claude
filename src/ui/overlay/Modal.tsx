import React from 'react';
import { Box, Text, type BoxProps } from 'ink';
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

/**
 * The background every modal row paints, and the padding that carries it
 * to the frame's edge.
 *
 * Box padding would leave transparent gaps and the interface behind would
 * show through the dialog, so each row pads itself. Width is counted in
 * characters, which is correct only while every glyph inside the frame is
 * single-width.
 *
 * Exported because `CommandPalette` renders result rows as its own Text:
 * a highlighted title is per-character markup, which ModalLine's flat
 * segments cannot express. Sharing these two keeps the one thing that
 * must not diverge, the opaque row, in a single place.
 */
export const ROW_BACKGROUND = 'black';

export function rowPadding(width: number, used: number): string {
  return ' '.repeat(Math.max(0, width - used));
}

/** One opaque row of a modal, padded to the modal's interior width. */
export function ModalLine({ segments, width }: { segments: Segment[]; width: number }) {
  const used = segments.reduce((total, segment) => total + segment.text.length, 0);
  return (
    <Text backgroundColor={ROW_BACKGROUND} wrap="truncate">
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
      {rowPadding(width, used)}
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
  borderStyle = 'double',
  width,
  children,
}: {
  borderColor?: string;
  /** The palette uses a different frame so it never reads as a dialog. */
  borderStyle?: BoxProps['borderStyle'];
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
      <Box flexDirection="column" borderStyle={borderStyle} borderColor={borderColor} width={width + 2}>
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
