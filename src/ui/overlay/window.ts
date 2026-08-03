/**
 * Scroll-offset math for windowed overlay lists.
 *
 * Ink does not clip overflow, so every list overlay renders a slice of its
 * rows and tracks its own offset. Both the action menu and the command
 * palette interleave headers with selectable rows, so both need the same
 * rule: keep the selected row on screen, and bring its group header along
 * with it when the header sits directly above.
 */
export interface RowOffsetOptions {
  /** Current offset, before this selection change. */
  base: number;
  /** Index of the row that must be visible. */
  row: number;
  /** Rows the viewport can show. */
  viewport: number;
  /** Total rows in the flattened list. */
  rowCount: number;
  /** True when the row directly above `row` is a group header. */
  headerAbove: boolean;
}

export function resolveRowOffset({
  base,
  row,
  viewport,
  rowCount,
  headerAbove,
}: RowOffsetOptions): number {
  const maxScroll = Math.max(0, rowCount - viewport);
  let next = Math.min(Math.max(0, base), maxScroll);
  if (row < next) next = row;
  else if (row >= next + viewport) next = row - viewport + 1;
  if (headerAbove && row - 1 < next) next = row - 1;
  return Math.max(0, Math.min(next, maxScroll));
}
