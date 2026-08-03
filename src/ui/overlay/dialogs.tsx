import React, { useMemo, useState } from 'react';
import { Modal, ModalLine, blankLine, textLine, useModalWidth, wrapText } from './Modal.js';
import {
  useOverlayInput,
  type ActionsSpec,
  type ConfirmSpec,
  type InputSpec,
  type OutputSpec,
  type PickerSpec,
} from './OverlayContext.js';
import { useTerminalSize } from '../useTerminalSize.js';
import {
  findShortcut,
  flattenActions,
  type ActionCategory,
  type ActionDefinition,
} from '../actions/registry.js';

export type { ActionDefinition as Action } from '../actions/registry.js';

/** Confirmation with an explicit y/n gate. */
export function ConfirmDialog({ overlay, onClose }: { overlay: ConfirmSpec & { id: number }; onClose: () => void }) {
  const width = useModalWidth(70);

  useOverlayInput(overlay.id, (input, key) => {
    if (input === 'y' || input === 'Y') {
      onClose();
      overlay.onResult(true);
    } else if (input === 'n' || input === 'N' || key.escape) {
      onClose();
      overlay.onResult(false);
    }
  });

  const accent = overlay.danger ? 'red' : 'yellow';
  return (
    <Modal borderColor={accent} width={width}>
      {blankLine(width)}
      {textLine(overlay.title, width, { bold: true, color: accent })}
      {blankLine(width)}
      {wrapText(overlay.message, width - 4).map((line, i) => (
        <React.Fragment key={i}>{textLine(line, width)}</React.Fragment>
      ))}
      {blankLine(width)}
      <ModalLine
        width={width}
        segments={[
          { text: '  ' },
          { text: 'y', bold: true, color: 'green' },
          { text: ' confirm    ' },
          { text: 'n/esc', bold: true, color: 'red' },
          { text: ' cancel' },
        ]}
      />
      {blankLine(width)}
    </Modal>
  );
}

/** Free-text entry, used for destinations and archive paths. */
export function InputDialog({ overlay, onClose }: { overlay: InputSpec & { id: number }; onClose: () => void }) {
  const width = useModalWidth(70);
  const [value, setValue] = useState(overlay.initial ?? '');

  useOverlayInput(overlay.id, (input, key) => {
    if (key.return) {
      const trimmed = value.trim();
      onClose();
      overlay.onResult(trimmed.length > 0 ? trimmed : null);
    } else if (key.escape) {
      onClose();
      overlay.onResult(null);
    } else if (key.ctrl && (input === 'u' || input === 'w')) {
      setValue('');
    } else if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      setValue((v) => v + input);
    }
  });

  // Keep the caret visible on long paths by showing the tail.
  const visible = value.length > width - 6 ? `…${value.slice(-(width - 7))}` : value;

  return (
    <Modal borderColor="cyan" width={width}>
      {blankLine(width)}
      {textLine(overlay.title, width, { bold: true, color: 'cyan' })}
      {blankLine(width)}
      {overlay.label
        ? wrapText(overlay.label, width - 4).map((line, i) => (
            <React.Fragment key={i}>{textLine(line, width, { dim: true })}</React.Fragment>
          ))
        : null}
      {blankLine(width)}
      <ModalLine
        width={width}
        segments={[
          { text: '  ' },
          { text: '> ', color: 'cyan' },
          { text: visible },
          { text: ' ', inverse: true },
        ]}
      />
      {blankLine(width)}
      {textLine('enter confirm, esc cancel, ctrl+u clear', width, { dim: true })}
      {blankLine(width)}
    </Modal>
  );
}

/** Scrollable single-choice list. */
export function PickerDialog({ overlay, onClose }: { overlay: PickerSpec & { id: number }; onClose: () => void }) {
  const width = useModalWidth(76);
  const { rows } = useTerminalSize();
  const [index, setIndex] = useState(0);
  const visible = Math.max(3, Math.min(overlay.options.length, rows - 12));

  useOverlayInput(overlay.id, (input, key) => {
    if (key.upArrow || input === 'k') setIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow || input === 'j') setIndex((i) => Math.min(overlay.options.length - 1, i + 1));
    else if (key.return) {
      onClose();
      overlay.onResult(overlay.options[index] ?? null, index);
    } else if (key.escape) {
      onClose();
      overlay.onResult(null, -1);
    } else if (/^[1-9]$/.test(input)) {
      const n = Number.parseInt(input, 10) - 1;
      if (n < overlay.options.length) {
        onClose();
        overlay.onResult(overlay.options[n], n);
      }
    }
  });

  const offset = Math.min(
    Math.max(0, index - visible + 1),
    Math.max(0, overlay.options.length - visible),
  );

  return (
    <Modal borderColor="cyan" width={width}>
      {blankLine(width)}
      {textLine(overlay.title, width, { bold: true, color: 'cyan' })}
      {blankLine(width)}
      {overlay.options.slice(offset, offset + visible).map((option, i) => {
        const real = offset + i;
        const selected = real === index;
        return (
          <ModalLine
            key={real}
            width={width}
            segments={[
              { text: selected ? '  > ' : '    ', color: 'green', bold: true },
              { text: option.slice(0, width - 6), color: selected ? 'green' : undefined },
            ]}
          />
        );
      })}
      {overlay.options.length > visible
        ? textLine(`… ${index + 1} of ${overlay.options.length}`, width, { dim: true })
        : null}
      {blankLine(width)}
      {textLine('enter select, esc cancel', width, { dim: true })}
      {blankLine(width)}
    </Modal>
  );
}

/** Scrollable read-only text, used for reports and help. */
export function OutputDialog({ overlay, onClose }: { overlay: OutputSpec & { id: number }; onClose: () => void }) {
  const { columns, rows } = useTerminalSize();
  const width = useModalWidth(columns - 10);
  const [scroll, setScroll] = useState(0);

  const lines = overlay.body.replaceAll('\r', '').split('\n');
  const visible = Math.max(3, rows - 10);
  const maxScroll = Math.max(0, lines.length - visible);

  useOverlayInput(overlay.id, (input, key) => {
    if (key.escape || input === 'q' || key.return) onClose();
    else if (key.upArrow || input === 'k') setScroll((s) => Math.max(0, s - 1));
    else if (key.downArrow || input === 'j') setScroll((s) => Math.min(maxScroll, s + 1));
    else if (input === ' ') setScroll((s) => Math.min(maxScroll, s + visible));
  });

  const offset = Math.min(scroll, maxScroll);

  return (
    <Modal borderColor="magenta" width={width}>
      {blankLine(width)}
      {textLine(overlay.title, width, { bold: true, color: 'magenta' })}
      {blankLine(width)}
      {lines.slice(offset, offset + visible).map((line, i) => (
        <React.Fragment key={offset + i}>{textLine(line.slice(0, width - 4), width)}</React.Fragment>
      ))}
      {blankLine(width)}
      {textLine(
        maxScroll > 0 ? `↑/↓ scroll (${offset}/${maxScroll}), esc close` : 'esc close',
        width,
        { dim: true },
      )}
      {blankLine(width)}
    </Modal>
  );
}

/** One rendered line of the palette. Only actions are selectable. */
type MenuRow =
  | { kind: 'spacer' }
  | { kind: 'header'; category: ActionCategory }
  | { kind: 'action'; category: ActionCategory; action: ActionDefinition; actionIndex: number };

/** Columns consumed by the rail, cursor and shortcut key of an action row. */
const ROW_PREFIX = 10;
/** Below this, a description is more misleading than missing, so it is dropped. */
const MIN_DESCRIPTION = 20;

/**
 * Categorized command palette.
 *
 * Sections carry their own colour and a guide rail, so scanning happens by
 * group rather than by reading every row. Only actions are selectable;
 * headers and rules are skipped by the cursor.
 *
 * The palette grows past most terminals, so it is windowed: the body shows
 * as many rows as the terminal has height for and scrolls with the cursor.
 * Column widths follow the terminal too, and the description column drops
 * entirely once there is no room for it.
 */
export function ActionMenu({ overlay, onClose }: { overlay: ActionsSpec & { id: number }; onClose: () => void }) {
  const { rows: terminalRows } = useTerminalSize();
  const [index, setIndex] = useState(0);
  const [scroll, setScroll] = useState(0);

  const flat = flattenActions(overlay.categories);

  // Ask for exactly the width the widest row needs; useModalWidth caps it
  // to the terminal, so wide terminals get whole descriptions and narrow
  // ones get as much as they can hold.
  const longestLabel = flat.reduce((max, action) => Math.max(max, action.label.length), 0);
  const longestDescription = flat.reduce(
    (max, action) => Math.max(max, action.description.length, (action.disabledReason ?? '').length),
    0,
  );
  const width = useModalWidth(ROW_PREFIX + longestLabel + 2 + longestDescription + 2);

  // Every line of the palette, headers and spacers included, so scrolling
  // moves by what is on screen instead of by action.
  const { rowList, rowOfAction } = useMemo(() => {
    const list: MenuRow[] = [];
    const byAction: number[] = [];
    let actionIndex = 0;
    overlay.categories.forEach((category, categoryIndex) => {
      if (categoryIndex > 0) list.push({ kind: 'spacer' });
      list.push({ kind: 'header', category });
      for (const action of category.actions) {
        byAction[actionIndex] = list.length;
        list.push({ kind: 'action', category, action, actionIndex });
        actionIndex += 1;
      }
    });
    return { rowList: list, rowOfAction: byAction };
  }, [overlay.categories]);

  // Chrome is traded away as the terminal shrinks: first the breathing room
  // around the body, then the rules. What is left always fits the height.
  const compact = terminalRows < 18;
  const tiny = terminalRows < 10;
  const chrome = tiny ? 4 : compact ? 6 : 8; // border, title, rules, footer, padding
  const viewport = Math.max(1, Math.min(rowList.length, terminalRows - chrome));
  const maxScroll = Math.max(0, rowList.length - viewport);

  /** Clamp an offset so the selected action, and its header, stay visible. */
  const resolveOffset = (base: number, actionIndex: number) => {
    const row = rowOfAction[actionIndex] ?? 0;
    let next = Math.min(Math.max(0, base), maxScroll);
    if (row < next) next = row;
    else if (row >= next + viewport) next = row - viewport + 1;
    if (rowList[row - 1]?.kind === 'header' && row - 1 < next) next = row - 1;
    return Math.max(0, Math.min(next, maxScroll));
  };

  const select = (nextIndex: number) => {
    const clamped = Math.max(0, Math.min(flat.length - 1, nextIndex));
    setIndex(clamped);
    setScroll((s) => resolveOffset(s, clamped));
  };

  useOverlayInput(overlay.id, (input, key) => {
    if (key.escape || input === 'q') {
      onClose();
      return;
    }
    if (key.upArrow || input === 'k') {
      select(index - 1);
      return;
    }
    if (key.downArrow || input === 'j') {
      select(index + 1);
      return;
    }
    if (key.pageUp) {
      select(index - viewport);
      return;
    }
    if (key.pageDown) {
      select(index + viewport);
      return;
    }
    if (key.return) {
      const action = flat[index];
      if (action && !action.disabled) {
        onClose();
        action.run();
      }
      return;
    }
    const direct = findShortcut(overlay.categories, input);
    if (direct) {
      onClose();
      direct.run();
    }
  });

  // Labels get the room they need before descriptions take the remainder.
  // A description column too narrow to be read is dropped, which gives the
  // labels the whole line on a narrow terminal.
  const available = Math.max(4, width - ROW_PREFIX - 2);
  const labelWidth = Math.max(4, Math.min(longestLabel, available));
  const descWidth = available - labelWidth - 2;
  const showDescriptions = descWidth >= MIN_DESCRIPTION;

  const offset = resolveOffset(scroll, index);
  const rule = <ModalLine width={width} segments={[{ text: `  ${'─'.repeat(Math.max(0, width - 4))}`, dim: true }]} />;

  const renderRow = (row: MenuRow, key: number) => {
    if (row.kind === 'spacer') return <React.Fragment key={key}>{blankLine(width)}</React.Fragment>;
    if (row.kind === 'header') {
      return (
        <ModalLine
          key={key}
          width={width}
          segments={[
            { text: '  ' },
            { text: row.category.title, bold: true, color: row.category.accent },
            ...(row.category.danger && width >= 60
              ? [{ text: '   destructive, cannot be undone', dim: true, color: 'red' }]
              : []),
          ]}
        />
      );
    }

    const { action, category } = row;
    const selected = row.actionIndex === index;
    const trailing = action.disabled ? (action.disabledReason ?? 'unavailable') : action.description;
    return (
      <ModalLine
        key={key}
        width={width}
        segments={[
          { text: '  ' },
          { text: '│ ', color: category.accent, dim: !selected },
          { text: selected ? '> ' : '  ', color: 'green', bold: true },
          {
            text: action.key.padEnd(4),
            bold: true,
            color: action.disabled ? undefined : action.danger ? 'red' : category.accent,
            dim: action.disabled,
          },
          {
            text: showDescriptions
              ? action.label.padEnd(labelWidth).slice(0, labelWidth)
              : action.label.slice(0, labelWidth),
            dim: action.disabled,
            bold: selected && !action.disabled,
          },
          ...(showDescriptions ? [{ text: `  ${trailing}`.slice(0, descWidth + 2), dim: true }] : []),
        ]}
      />
    );
  };

  // The footer gives up detail before it gives up the position counter:
  // knowing there is more list below matters more than the key legend.
  const counter = rowList.length > viewport ? `↑/↓ ${index + 1}/${flat.length}` : '';
  const separator = '  ·  ';
  const room = Math.max(0, width - 4 - (counter ? counter.length + separator.length : 0));
  const long = 'enter runs the selection, a shortcut key runs directly, esc closes';
  const short = 'enter run, esc close';
  const hint = long.length <= room ? long : short.length <= room ? short : '';
  const footer = hint && counter ? `${hint}${separator}${counter}` : hint || counter;

  return (
    <Modal borderColor="cyan" width={width}>
      {compact ? null : blankLine(width)}
      {textLine(overlay.title, width, { bold: true, color: 'cyan' })}
      {tiny ? null : rule}

      {rowList.slice(offset, offset + viewport).map((row, i) => renderRow(row, offset + i))}

      {tiny ? null : rule}
      {textLine(footer, width, { dim: true })}
      {compact ? null : blankLine(width)}
    </Modal>
  );
}
