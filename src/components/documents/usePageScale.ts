'use client';

import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { pageScaleFor } from '@/lib/document-page';

export interface PageScale {
  scale: number;
  height: number | undefined;
}

const FULL_SIZE: PageScale = { scale: 1, height: undefined };

export const OUTLINE_RESERVE_REM = 20 + 1.5 + 1.5;

export function usePageScale(
  scroller: RefObject<HTMLElement | null>,
  stack: RefObject<HTMLElement | null>,
  paged: boolean,
  reserveOutline: boolean,
): PageScale {
  const [measured, setMeasured] = useState<PageScale>(FULL_SIZE);

  useEffect(() => {
    const available = scroller.current;
    const sheet = stack.current;
    if (!paged || available === null || sheet === null) {
      setMeasured(FULL_SIZE);
      return;
    }

    const measure = () => {
      const rem = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
      const reserved = reserveOutline ? OUTLINE_RESERVE_REM * rem : 0;
      const scale = pageScaleFor(available.clientWidth - reserved);
      const height = scale < 1 ? sheet.offsetHeight * scale : undefined;
      setMeasured((previous) =>
        previous.scale === scale && previous.height === height ? previous : { scale, height },
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(available);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [scroller, stack, paged, reserveOutline]);

  return measured;
}
