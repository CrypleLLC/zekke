'use client';

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { chartAccessibleName } from '@/lib/app';
import {
  anchorRect,
  chartOption,
  movedRect,
  resizedRect,
  type ChartValue,
  type ContentRect,
  type ResolvedChart,
} from '@/lib/spreadsheets';
import ChartCanvas from './ChartCanvas';
import type { ChartViewSource, SheetView } from './chart-view';
import type { PlacedChart } from './useSheetCharts';

type Gesture = 'move' | 'resize';

interface Drag {
  id: string;
  gesture: Gesture;
  startX: number;
  startY: number;
  rect: ContentRect;
  current: ContentRect;
}

export interface ChartLayerProps {
  source: ChartViewSource;
  view: SheetView;
  charts: PlacedChart[];
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  onPlace: (chart: ResolvedChart, rect: ContentRect) => void;
  onRemove: (chart: ResolvedChart) => void;
  onUndo: (redo: boolean) => void;
}

export default function ChartLayer({
  source,
  view,
  charts,
  selectedId,
  onSelect,
  onPlace,
  onRemove,
  onUndo,
}: ChartLayerProps) {
  const [drag, setDrag] = useState<Drag>();
  const dragRef = useRef<Drag | undefined>(undefined);

  function begin(event: PointerEvent<HTMLElement>, chart: ResolvedChart, gesture: Gesture) {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.closest<HTMLElement>('[data-chart]')?.focus({ preventScroll: true });
    onSelect(chart.id);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const rect = anchorRect(view.rows, view.columns, chart.anchor);
    const started: Drag = { id: chart.id, gesture, startX: event.clientX, startY: event.clientY, rect, current: rect };
    dragRef.current = started;
    setDrag(started);
  }

  function follow(event: PointerEvent<HTMLElement>) {
    const current = dragRef.current;
    if (current === undefined) {
      return;
    }
    const deltaX = (event.clientX - current.startX) / view.scaleX;
    const deltaY = (event.clientY - current.startY) / view.scaleY;
    const next: Drag = {
      ...current,
      current:
        current.gesture === 'move'
          ? movedRect(current.rect, deltaX, deltaY, view.rows, view.columns)
          : resizedRect(current.rect, deltaX, deltaY),
    };
    dragRef.current = next;
    setDrag(next);
  }

  function end(chart: ResolvedChart) {
    const finished = dragRef.current;
    dragRef.current = undefined;
    setDrag(undefined);
    if (finished === undefined) {
      return;
    }
    const moved =
      finished.current.left !== finished.rect.left ||
      finished.current.top !== finished.rect.top ||
      finished.current.width !== finished.rect.width ||
      finished.current.height !== finished.rect.height;
    if (moved) {
      onPlace(chart, finished.current);
    }
  }

  function keyDown(event: KeyboardEvent<HTMLElement>, chart: ResolvedChart) {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onRemove(chart);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onSelect(undefined);
      (event.currentTarget as HTMLElement).blur();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      onUndo(event.shiftKey);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      onUndo(true);
    }
  }

  function wheel(event: WheelEvent<HTMLElement>) {
    source.forwardWheel(event.nativeEvent);
  }

  return (
    <div
      className="pointer-events-none absolute overflow-hidden"
      style={{ left: view.clip.left, top: view.clip.top, width: view.clip.width, height: view.clip.height }}
    >
      {charts.map(({ chart, values }) => {
        const content = drag?.id === chart.id ? drag.current : anchorRect(view.rows, view.columns, chart.anchor);
        const screen = view.toScreen(content);
        const selected = chart.id === selectedId;
        return (
          <section
            key={chart.id}
            data-chart={chart.id}
            role="group"
            tabIndex={0}
            aria-label={chartAccessibleName(chart.settings.title)}
            onPointerDown={(event) => begin(event, chart, 'move')}
            onPointerMove={follow}
            onPointerUp={() => end(chart)}
            onPointerCancel={() => end(chart)}
            onKeyDown={(event) => keyDown(event, chart)}
            onFocus={() => onSelect(chart.id)}
            onWheel={wheel}
            className={`pointer-events-auto absolute cursor-move touch-none bg-white shadow-card outline-none ${
              selected ? 'ring-2 ring-brand-500' : 'ring-1 ring-line hover:ring-brand-300'
            }`}
            style={{
              left: screen.left - view.clip.left,
              top: screen.top - view.clip.top,
              width: screen.width,
              height: screen.height,
            }}
          >
            <ChartFigure
              chart={chart}
              values={values}
              width={screen.width}
              height={screen.height}
            />
            {selected ? (
              <span
                aria-hidden="true"
                onPointerDown={(event) => begin(event, chart, 'resize')}
                onPointerMove={follow}
                onPointerUp={() => end(chart)}
                onPointerCancel={() => end(chart)}
                className="absolute -right-1.5 -bottom-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border-2 border-brand-500 bg-white"
              />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function ChartFigure({
  chart,
  values,
  width,
  height,
}: {
  chart: ResolvedChart;
  values: ChartValue[][];
  width: number;
  height: number;
}) {
  const option = useMemo(() => chartOption(chart.settings, values), [chart.settings, values]);
  return (
    <div className="pointer-events-none h-full w-full">
      <ChartCanvas option={option} width={width} height={height} />
    </div>
  );
}
