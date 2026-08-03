import React from 'react';
import { Text } from 'ink';

/**
 * Render text with the fuzzy-matched characters emphasised, fitted to an
 * exact column width so a selected row still paints a full highlight bar.
 *
 * Matches render bold yellow, which stays legible both on the blue
 * selection bar and on the default background.
 */
export function highlighted(
  prefix: string,
  text: string,
  positions: number[] | undefined,
  width: number,
): React.ReactNode[] {
  const fitted = fit(text, Math.max(0, width - prefix.length));
  // Ink's Text renders a flat list of strings and Text elements. Returning
  // a single array (never a Fragment) keeps it able to measure the line.
  if (!positions || positions.length === 0) return [prefix, fitted];

  const marked = new Set(positions);
  const segments: React.ReactNode[] = [prefix];
  let buffer = '';
  let bufferMarked = false;

  const flush = (key: number) => {
    if (!buffer) return;
    segments.push(
      bufferMarked ? (
        <Text key={key} bold color="yellow">
          {buffer}
        </Text>
      ) : (
        buffer
      ),
    );
    buffer = '';
  };

  for (let i = 0; i < fitted.length; i++) {
    const isMarked = marked.has(i);
    if (isMarked !== bufferMarked) {
      flush(i);
      bufferMarked = isMarked;
    }
    buffer += fitted[i];
  }
  flush(fitted.length);

  return segments;
}

/** Pad or truncate to exactly `width` columns. */
export function fit(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length > width) return `${text.slice(0, Math.max(0, width - 1))}…`;
  return text.padEnd(width);
}
