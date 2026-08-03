import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useInput } from 'ink';
import type { ActionCategory } from '../actions/registry.js';
import type { JumpTarget } from '../../services/search/types.js';

/**
 * Overlay stack.
 *
 * Overlays are data, not screens: the application tree stays mounted and
 * the host renders the stack as a final absolutely-positioned sibling.
 * Because it is a stack rather than a single slot, nested dialogs (a
 * confirmation raised from a picker) work without any extra machinery,
 * and closing one reveals whatever was beneath it with panel state and
 * selection untouched.
 */

export interface ConfirmSpec {
  kind: 'confirm';
  title: string;
  message: string;
  danger?: boolean;
  onResult: (confirmed: boolean) => void;
}

export interface InputSpec {
  kind: 'input';
  title: string;
  label?: string;
  initial?: string;
  onResult: (value: string | null) => void;
}

export interface PickerSpec {
  kind: 'picker';
  title: string;
  options: string[];
  onResult: (value: string | null, index: number) => void;
}

export interface OutputSpec {
  kind: 'output';
  title: string;
  body: string;
}

export interface ActionsSpec {
  kind: 'actions';
  title: string;
  categories: ActionCategory[];
}

/**
 * The global command palette. It carries no data: the palette reads the
 * workspace index itself, and hands back only where to go.
 */
export interface PaletteSpec {
  kind: 'palette';
  onSelect: (target: JumpTarget) => void;
}

export type OverlaySpec =
  | ConfirmSpec
  | InputSpec
  | PickerSpec
  | OutputSpec
  | ActionsSpec
  | PaletteSpec;

export type Overlay = OverlaySpec & { id: number };

interface OverlayApi {
  overlays: Overlay[];
  /** Push an overlay and return its id. */
  open: (spec: OverlaySpec) => number;
  /** Close the top overlay, or a specific one by id. */
  close: (id?: number) => void;
  closeAll: () => void;
  /** True when no overlay is open, so panels may take input. */
  idle: boolean;
  topId: number | null;
}

const OverlayContext = createContext<OverlayApi | null>(null);

export function OverlayProvider({ children }: { children: React.ReactNode }) {
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const nextId = useRef(1);

  const open = useCallback((spec: OverlaySpec) => {
    const id = nextId.current++;
    setOverlays((stack) => [...stack, { ...spec, id }]);
    return id;
  }, []);

  const close = useCallback((id?: number) => {
    setOverlays((stack) => {
      if (stack.length === 0) return stack;
      if (id === undefined) return stack.slice(0, -1);
      return stack.filter((overlay) => overlay.id !== id);
    });
  }, []);

  const closeAll = useCallback(() => setOverlays([]), []);

  const value = useMemo<OverlayApi>(
    () => ({
      overlays,
      open,
      close,
      closeAll,
      idle: overlays.length === 0,
      topId: overlays.length > 0 ? overlays[overlays.length - 1].id : null,
    }),
    [overlays, open, close, closeAll],
  );

  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>;
}

export function useOverlays(): OverlayApi {
  const api = useContext(OverlayContext);
  if (!api) throw new Error('useOverlays must be used inside an OverlayProvider');
  return api;
}

/**
 * Keyboard input for an overlay. Only the top overlay of the stack is
 * ever active, so the panels underneath and any lower dialogs are inert.
 */
export function useOverlayInput(
  id: number,
  handler: Parameters<typeof useInput>[0],
  enabled = true,
): void {
  const { topId } = useOverlays();
  useInput(handler, { isActive: enabled && topId === id });
}

/**
 * Keyboard input for the application behind the overlays. Disabled
 * whenever anything is open, which is the single gate that keeps
 * background panels from reacting to dialog keystrokes.
 */
export function useAppInput(handler: Parameters<typeof useInput>[0], enabled = true): void {
  const { idle } = useOverlays();
  useInput(handler, { isActive: enabled && idle });
}
