'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export const TOOL_MENU_CLOSE_DELAY_MS = 400;

export function useToolMenu() {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const cancelClose = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);

  const close = useCallback(() => {
    cancelClose();
    setOpen(false);
  }, [cancelClose]);

  const toggle = useCallback(() => {
    cancelClose();
    setOpen((previous) => !previous);
  }, [cancelClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        close();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  useEffect(() => cancelClose, [cancelClose]);

  const onPointerLeave = (event: ReactPointerEvent) => {
    if (!open || event.pointerType !== 'mouse') {
      return;
    }
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      if (!container.current?.contains(document.activeElement)) {
        setOpen(false);
      }
    }, TOOL_MENU_CLOSE_DELAY_MS);
  };

  return {
    open,
    close,
    toggle,
    container,
    containerProps: { ref: container, onPointerEnter: cancelClose, onPointerLeave },
  };
}
