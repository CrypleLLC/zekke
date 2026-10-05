'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, RefObject } from 'react';
import {
  MARGIN_FINE_STEP_MM,
  MARGIN_LARGE_STEP_MM,
  MARGIN_NAMES,
  MARGIN_STEP_MM,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  isVertical,
  marginLabel,
  maxMargin,
  millimetresFromPixels,
  moveMargin,
  snapMargin,
  type MarginSide,
  type PageMargins,
} from '@/lib/document-page';

export interface MarginControls {
  margins: PageMargins;
  scale: number;
  onPreview: (margins: PageMargins) => void;
  onCommit: (margins: PageMargins) => void;
  onCancel: () => void;
}

export function HorizontalRuler({
  stack,
  scroller,
  ...controls
}: MarginControls & {
  stack: RefObject<HTMLDivElement | null>;
  scroller: RefObject<HTMLDivElement | null>;
}) {
  const dock = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const { margins } = controls;

  useLayoutEffect(() => {
    const row = dock.current;
    const sheet = stack.current;
    const scrolling = scroller.current;
    const element = ruler.current;
    if (row === null || sheet === null || scrolling === null || element === null) {
      return;
    }

    const place = () => {
      const page = sheet.getBoundingClientRect();
      const offset = page.left - row.getBoundingClientRect().left;
      element.style.width = `${page.width}px`;
      element.style.transform = `translateX(${offset}px)`;
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(row);
    observer.observe(sheet);
    scrolling.addEventListener('scroll', place, { passive: true });
    return () => {
      observer.disconnect();
      scrolling.removeEventListener('scroll', place);
    };
  }, [stack, scroller]);

  return (
    <div ref={dock} className="zekke-ruler-dock zekke-no-print">
      <div ref={ruler} className="zekke-ruler zekke-ruler-horizontal">
        <div className="zekke-ruler-margin" style={{ left: 0, width: scaled(margins.left, 'mm') }} />
        <div className="zekke-ruler-margin" style={{ right: 0, width: scaled(margins.right, 'mm') }} />
        <RulerScale centimetres={PAGE_WIDTH_MM / 10} vertical={false} />
        <MarginHandle side="left" ruler={ruler} accessible {...controls} />
        <MarginHandle side="right" ruler={ruler} accessible {...controls} />
      </div>
    </div>
  );
}

export function VerticalRulers({ pages, ...controls }: MarginControls & { pages: number }) {
  return (
    <div className="zekke-ruler-column zekke-no-print">
      {Array.from({ length: pages }, (_, page) => (
        <div key={page} className="zekke-ruler-slot">
          <VerticalRuler accessible={page === 0} {...controls} />
        </div>
      ))}
    </div>
  );
}

function VerticalRuler({ accessible, ...controls }: MarginControls & { accessible: boolean }) {
  const ruler = useRef<HTMLDivElement>(null);
  const { margins } = controls;

  return (
    <div
      ref={ruler}
      className="zekke-ruler zekke-ruler-vertical"
      aria-hidden={accessible ? undefined : true}
    >
      <div className="zekke-ruler-margin" style={{ top: 0, height: scaled(margins.top, 'mm') }} />
      <div className="zekke-ruler-margin" style={{ bottom: 0, height: scaled(margins.bottom, 'mm') }} />
      <RulerScale centimetres={PAGE_HEIGHT_MM / 10} vertical />
      <MarginHandle side="top" ruler={ruler} accessible={accessible} {...controls} />
      <MarginHandle side="bottom" ruler={ruler} accessible={accessible} {...controls} />
    </div>
  );
}

function RulerScale({ centimetres, vertical }: { centimetres: number; vertical: boolean }) {
  const labels = Array.from({ length: Math.floor(centimetres) - 1 }, (_, index) => index + 1);

  return (
    <div aria-hidden="true" className="zekke-ruler-scale">
      {labels.map((label) => (
        <span
          key={label}
          className="zekke-ruler-label"
          style={vertical ? { top: scaled(label, 'cm') } : { left: scaled(label, 'cm') }}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function pointerDistance(side: MarginSide, rect: DOMRect, event: PointerEvent): number {
  switch (side) {
    case 'left':
      return event.clientX - rect.left;
    case 'right':
      return rect.right - event.clientX;
    case 'top':
      return event.clientY - rect.top;
    case 'bottom':
      return rect.bottom - event.clientY;
  }
}

function handlePosition(side: MarginSide, margin: number): CSSProperties {
  return { [side]: scaled(margin, 'mm') };
}

function scaled(value: number, unit: 'mm' | 'cm'): string {
  return `calc(${value}${unit} * var(--page-scale, 1))`;
}

function MarginHandle({
  side,
  ruler,
  accessible,
  margins,
  scale,
  onPreview,
  onCommit,
  onCancel,
}: MarginControls & {
  side: MarginSide;
  ruler: RefObject<HTMLDivElement | null>;
  accessible: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const start = useRef<PageMargins>(margins);
  const latest = useRef<PageMargins>(margins);
  const keyed = useRef(false);
  const held = useRef(false);
  const name = MARGIN_NAMES[side];
  const label = marginLabel(margins[side]);

  const preview = (next: PageMargins) => {
    latest.current = next;
    onPreview(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = margins;
    latest.current = margins;
    held.current = true;
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = ruler.current?.getBoundingClientRect();
    if (!held.current || rect === undefined) {
      return;
    }
    const step = event.altKey ? MARGIN_FINE_STEP_MM : MARGIN_STEP_MM;
    const distance = pointerDistance(side, rect, event) / scale;
    const wanted = snapMargin(millimetresFromPixels(distance), step);
    preview(moveMargin(start.current, side, wanted));
  };

  const finish = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (!held.current) {
      return;
    }
    held.current = false;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (commit) {
      onCommit(latest.current);
    } else {
      onCancel();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey
      ? MARGIN_LARGE_STEP_MM
      : event.altKey
        ? MARGIN_FINE_STEP_MM
        : MARGIN_STEP_MM;
    const targets: Record<string, number> = {
      ArrowUp: margins[side] + step,
      ArrowRight: margins[side] + step,
      ArrowDown: margins[side] - step,
      ArrowLeft: margins[side] - step,
      Home: 0,
      End: maxMargin(margins, side),
    };
    const target = targets[event.key];
    if (target === undefined || held.current) {
      return;
    }
    event.preventDefault();
    keyed.current = true;
    preview(moveMargin(margins, side, target));
  };

  const commitKeys = () => {
    if (keyed.current) {
      keyed.current = false;
      onCommit(latest.current);
    }
  };

  return (
    <div
      role="slider"
      tabIndex={accessible ? 0 : -1}
      aria-hidden={accessible ? undefined : true}
      aria-label={name}
      aria-orientation={isVertical(side) ? 'vertical' : 'horizontal'}
      aria-valuemin={0}
      aria-valuemax={maxMargin(margins, side)}
      aria-valuenow={margins[side]}
      aria-valuetext={label}
      title={`${name}: ${label}`}
      data-side={side}
      data-dragging={dragging ? '' : undefined}
      className="zekke-ruler-handle"
      style={handlePosition(side, margins[side])}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
      onLostPointerCapture={() => {
        if (held.current) {
          held.current = false;
          setDragging(false);
          onCancel();
        }
      }}
      onKeyDown={onKeyDown}
      onKeyUp={commitKeys}
      onBlur={commitKeys}
    >
      <span aria-hidden="true" className="zekke-ruler-marker" />
      <span aria-hidden="true" className="zekke-ruler-value">
        {label}
      </span>
    </div>
  );
}
