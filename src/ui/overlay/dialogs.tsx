import React, { useState } from 'react';
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

export interface Action {
  /** Single-key shortcut that also works outside the menu. */
  key: string;
  label: string;
  description: string;
  run: () => void;
  /** Disabled actions stay listed so the menu doubles as documentation. */
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
}

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

/** Contextual action palette. */
export function ActionMenu({ overlay, onClose }: { overlay: ActionsSpec & { id: number }; onClose: () => void }) {
  const width = useModalWidth(78);
  const [index, setIndex] = useState(0);

  useOverlayInput(overlay.id, (input, key) => {
    if (key.escape || input === 'q') {
      onClose();
      return;
    }
    if (key.upArrow || input === 'k') {
      setIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setIndex((i) => Math.min(overlay.actions.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const action = overlay.actions[index];
      if (action && !action.disabled) {
        onClose();
        action.run();
      }
      return;
    }
    const direct = overlay.actions.find((a) => a.key === input && !a.disabled);
    if (direct) {
      onClose();
      direct.run();
    }
  });

  const labelWidth = 22;
  const descWidth = Math.max(10, width - labelWidth - 12);

  return (
    <Modal borderColor="cyan" width={width}>
      {blankLine(width)}
      {textLine(overlay.title, width, { bold: true, color: 'cyan' })}
      {blankLine(width)}
      {overlay.actions.map((action, i) => {
        const selected = i === index;
        return (
          <ModalLine
            key={`${action.key}-${action.label}`}
            width={width}
            segments={[
              { text: selected ? '  > ' : '    ', color: 'green', bold: true },
              {
                text: action.key.padEnd(6),
                bold: true,
                color: action.disabled ? undefined : action.danger ? 'red' : 'cyan',
                dim: action.disabled,
              },
              { text: action.label.padEnd(labelWidth).slice(0, labelWidth), dim: action.disabled },
              {
                text: (action.disabled ? (action.disabledReason ?? 'unavailable') : action.description).slice(
                  0,
                  descWidth,
                ),
                dim: true,
              },
            ]}
          />
        );
      })}
      {blankLine(width)}
      {textLine('enter run, shortcut key runs directly, esc close', width, { dim: true })}
      {blankLine(width)}
    </Modal>
  );
}
