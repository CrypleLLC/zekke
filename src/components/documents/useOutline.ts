'use client';

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { headingAtScroll, readOutline, type HeadingOffset, type OutlineEntry } from '@/lib/documents';

const OUTLINE_DEBOUNCE_MS = 200;

export function useOutline(editor: Editor | null): OutlineEntry[] {
  const [entries, setEntries] = useState<OutlineEntry[]>([]);

  useEffect(() => {
    if (editor === null) {
      setEntries([]);
      return;
    }

    let timer = 0;
    const read = () => setEntries(readOutline(editor.state.doc));
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, OUTLINE_DEBOUNCE_MS);
    };

    read();
    editor.on('update', schedule);

    return () => {
      window.clearTimeout(timer);
      editor.off('update', schedule);
    };
  }, [editor]);

  return entries;
}

const READING_LINE_TOLERANCE_PX = 8;
const BOTTOM_TOLERANCE_PX = 2;

export function useScrolledHeading(
  editor: Editor | null,
  entries: readonly OutlineEntry[],
): number | undefined {
  const [active, setActive] = useState<number>();

  useEffect(() => {
    if (editor === null || entries.length === 0) {
      setActive(undefined);
      return;
    }

    let frame = 0;
    const read = () => {
      frame = 0;
      if (editor.isDestroyed) {
        return;
      }

      const elements = headingElements(editor, entries);
      const first = elements[0]?.element;
      const readingLine =
        first === undefined
          ? 0
          : (Number.parseFloat(window.getComputedStyle(first).scrollMarginTop) || 0) +
            READING_LINE_TOLERANCE_PX;
      const root = document.documentElement;

      setActive(
        headingAtScroll(
          elements.map(({ pos, element }) => ({ pos, top: element.getBoundingClientRect().top })),
          {
            readingLine,
            viewportBottom: window.innerHeight,
            atBottom:
              window.scrollY + window.innerHeight >= root.scrollHeight - BOTTOM_TOLERANCE_PX,
          },
        ),
      );
    };
    const schedule = () => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(read);
      }
    };

    read();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [editor, entries]);

  return active;
}

interface HeadingElement extends Pick<HeadingOffset, 'pos'> {
  element: HTMLElement;
}

function headingElements(editor: Editor, entries: readonly OutlineEntry[]): HeadingElement[] {
  return entries.flatMap((entry) => {
    const element = editor.view.nodeDOM(entry.pos);
    return element instanceof HTMLElement && /^H[1-6]$/.test(element.tagName)
      ? [{ pos: entry.pos, element }]
      : [];
  });
}

export function goToHeading(editor: Editor, pos: number, options: { focus?: boolean } = {}): void {
  if (options.focus ?? true) {
    editor.commands.focus(pos + 1, { scrollIntoView: false });
  }

  const dom = editor.view.nodeDOM(pos);
  if (dom instanceof HTMLElement) {
    dom.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
