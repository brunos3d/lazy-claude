import React from 'react';
import { useOverlays } from './OverlayContext.js';
import { ActionMenu, ConfirmDialog, InputDialog, OutputDialog, PickerDialog } from './dialogs.js';

/**
 * Renders the overlay stack. Mount this as the LAST child of the root
 * layout: Ink composites siblings in order, so drawing here puts dialogs
 * above the panels.
 *
 * Every overlay in the stack is rendered, not just the top one, so a
 * confirmation raised from a picker still shows the picker behind it.
 * Only the top overlay receives input (see useOverlayInput).
 */
export function OverlayHost() {
  const { overlays, close } = useOverlays();
  if (overlays.length === 0) return null;

  return (
    <>
      {overlays.map((overlay) => {
        const onClose = () => close(overlay.id);
        switch (overlay.kind) {
          case 'confirm':
            return <ConfirmDialog key={overlay.id} overlay={overlay} onClose={onClose} />;
          case 'input':
            return <InputDialog key={overlay.id} overlay={overlay} onClose={onClose} />;
          case 'picker':
            return <PickerDialog key={overlay.id} overlay={overlay} onClose={onClose} />;
          case 'output':
            return <OutputDialog key={overlay.id} overlay={overlay} onClose={onClose} />;
          case 'actions':
            return <ActionMenu key={overlay.id} overlay={overlay} onClose={onClose} />;
        }
      })}
    </>
  );
}
