'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import {
  QUICK_RETURN_THRESHOLD_PX,
  keyboardInset,
  nextQuickReturn,
  quickReturnStart,
} from '@/lib/app';

export const DOCSIDE_QUERY = '(min-width: 81.25rem)';

export const COARSE_POINTER_QUERY = '(pointer: coarse)';

function useMediaQuery(query: string, serverValue: boolean): boolean {
  return useSyncExternalStore(
    useCallback(
      (onChange: () => void) => {
        const list = window.matchMedia(query);
        list.addEventListener('change', onChange);
        return () => list.removeEventListener('change', onChange);
      },
      [query],
    ),
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

export function useWideLayout(): boolean {
  return useMediaQuery(DOCSIDE_QUERY, true);
}

export function useCoarsePointer(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY, false);
}

export function useQuickReturn(enabled: boolean, pinned: boolean): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }

    let state = quickReturnStart(window.scrollY);
    let frame = 0;
    const read = () => {
      frame = 0;
      const chrome =
        Number.parseFloat(
          window.getComputedStyle(document.documentElement).getPropertyValue('--doc-chrome-h'),
        ) || 0;
      state = nextQuickReturn(state, window.scrollY, {
        threshold: QUICK_RETURN_THRESHOLD_PX,
        revealZone: chrome,
      });
      setHidden(state.hidden);
    };
    const schedule = () => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(read);
      }
    };

    window.addEventListener('scroll', schedule, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
    };
  }, [enabled]);

  const shownAnyway = !enabled || pinned;
  const effective = hidden && !shownAnyway;

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--doc-chrome-visible', effective ? '0px' : 'var(--doc-chrome-h, 8rem)');
    return () => {
      root.style.removeProperty('--doc-chrome-visible');
    };
  }, [effective]);

  return effective;
}

export function useKeyboardInset(enabled: boolean): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    if (!enabled || viewport === null) {
      return;
    }

    const update = () => {
      root.style.setProperty(
        '--keyboard-inset',
        `${keyboardInset(window.innerHeight, viewport.height, viewport.offsetTop)}px`,
      );
    };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      root.style.removeProperty('--keyboard-inset');
    };
  }, [enabled]);
}

export function useFocusWithin(ref: RefObject<HTMLElement | null>): boolean {
  const [within, setWithin] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    const onFocusIn = () => setWithin(true);
    const onFocusOut = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node) || !element.contains(event.relatedTarget)) {
        setWithin(false);
      }
    };

    element.addEventListener('focusin', onFocusIn);
    element.addEventListener('focusout', onFocusOut);
    return () => {
      element.removeEventListener('focusin', onFocusIn);
      element.removeEventListener('focusout', onFocusOut);
    };
  }, [ref]);

  return within;
}

export function useEditing(editor: Editor | null, dock: RefObject<HTMLElement | null>): boolean {
  const [editing, setEditing] = useState(false);

  const evaluate = useCallback(() => {
    const active = document.activeElement;
    const inEditor = editor !== null && !editor.isDestroyed && editor.view.dom.contains(active);
    const inDock = dock.current?.contains(active) ?? false;
    setEditing(inEditor || inDock);
  }, [editor, dock]);

  useEffect(() => {
    let timer = 0;
    const settle = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(evaluate, 0);
    };

    evaluate();
    document.addEventListener('focusin', settle);
    document.addEventListener('focusout', settle);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('focusin', settle);
      document.removeEventListener('focusout', settle);
    };
  }, [evaluate]);

  return editing;
}
