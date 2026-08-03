import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

/**
 * Generic modal building blocks. Each dialog owns its keyboard input via
 * useInput({ isActive }), so the App only arbitrates which modal is on top.
 */

export interface ConfirmModal {
  kind: 'confirm';
  title: string;
  message: string;
  danger?: boolean;
  onResult: (confirmed: boolean) => void;
}

export interface InputModal {
  kind: 'input';
  title: string;
  label?: string;
  initial?: string;
  onResult: (value: string | null) => void;
}

export interface SelectModal {
  kind: 'select';
  title: string;
  options: string[];
  onResult: (value: string | null, index: number) => void;
}

export interface OverlayModal {
  kind: 'overlay';
  title: string;
  body: string;
  onClose?: () => void;
}

export type Modal = ConfirmModal | InputModal | SelectModal | OverlayModal;

export function ConfirmDialog({ modal, active }: { modal: ConfirmModal; active: boolean }) {
  useInput(
    (input, key) => {
      if (input === 'y' || input === 'Y') modal.onResult(true);
      else if (input === 'n' || input === 'N' || key.escape) modal.onResult(false);
    },
    { isActive: active },
  );

  return (
    <Box
      borderStyle="double"
      borderColor={modal.danger ? 'red' : 'yellow'}
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color={modal.danger ? 'red' : 'yellow'}>
        {modal.title}
      </Text>
      <Box marginTop={1} width={64}>
        <Text wrap="wrap">{modal.message}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>
          <Text bold color="green">
            y
          </Text>
          <Text> confirm  </Text>
          <Text bold color="red">
            n/esc
          </Text>
          <Text> cancel</Text>
        </Text>
      </Box>
    </Box>
  );
}

export function InputDialog({ modal, active }: { modal: InputModal; active: boolean }) {
  const [value, setValue] = useState(modal.initial ?? '');

  useInput(
    (input, key) => {
      if (key.return) {
        const trimmed = value.trim();
        modal.onResult(trimmed.length > 0 ? trimmed : null);
      } else if (key.escape) {
        modal.onResult(null);
      } else if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        setValue((v) => v + input);
      }
    },
    { isActive: active },
  );

  return (
    <Box borderStyle="double" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="cyan">
        {modal.title}
      </Text>
      {modal.label ? (
        <Box marginTop={1} width={64}>
          <Text dimColor wrap="wrap">
            {modal.label}
          </Text>
        </Box>
      ) : null}
      <Box marginTop={1} width={64}>
        <Text>
          <Text color="cyan">{'> '}</Text>
          {value}
          <Text inverse> </Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>enter confirm, esc cancel</Text>
      </Box>
    </Box>
  );
}

export function SelectDialog({ modal, active }: { modal: SelectModal; active: boolean }) {
  const [index, setIndex] = useState(0);

  useInput(
    (input, key) => {
      if (key.upArrow || input === 'k') setIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow || input === 'j') {
        setIndex((i) => Math.min(modal.options.length - 1, i + 1));
      } else if (key.return) modal.onResult(modal.options[index] ?? null, index);
      else if (key.escape) modal.onResult(null, -1);
      else if (/^[1-9]$/.test(input)) {
        const n = Number.parseInt(input, 10) - 1;
        if (n < modal.options.length) modal.onResult(modal.options[n], n);
      }
    },
    { isActive: active },
  );

  const visible = 12;
  const offset = Math.min(Math.max(0, index - visible + 1), Math.max(0, modal.options.length - visible));

  return (
    <Box borderStyle="double" borderColor="cyan" flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="cyan">
        {modal.title}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {modal.options.slice(offset, offset + visible).map((option, i) => {
          const real = offset + i;
          return (
            <Text key={real} color={real === index ? 'green' : undefined} wrap="truncate">
              {real === index ? '> ' : '  '}
              {option}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>enter select, esc cancel</Text>
      </Box>
    </Box>
  );
}

export function OverlayView({
  modal,
  active,
  width,
  height,
  onClose,
}: {
  modal: OverlayModal;
  active: boolean;
  width: number;
  height: number;
  onClose: () => void;
}) {
  const [scroll, setScroll] = useState(0);
  const innerHeight = Math.max(3, height - 6);
  const lines = modal.body.replaceAll('\r', '').split('\n');
  const maxScroll = Math.max(0, lines.length - innerHeight);

  useInput(
    (input, key) => {
      if (key.escape || input === 'q' || key.return) onClose();
      else if (key.upArrow || input === 'k') setScroll((s) => Math.max(0, s - 1));
      else if (key.downArrow || input === 'j') setScroll((s) => Math.min(maxScroll, s + 1));
    },
    { isActive: active },
  );

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
        {modal.title}
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
          esc close
        </Text>
      </Box>
    </Box>
  );
}
