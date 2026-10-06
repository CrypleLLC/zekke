'use client';

import { useEffect, useState, type RefObject } from 'react';
import type * as Y from 'yjs';
import { readCharts, readSheet, type ChartValue, type ResolvedChart } from '@/lib/spreadsheets';
import { collectChanges, emptyChanges } from './changes';
import type { ChartViewSource, SheetView } from './chart-view';

export interface PlacedChart {
  chart: ResolvedChart;
  values: ChartValue[][];
}

export interface SheetCharts {
  view: SheetView | undefined;
  charts: PlacedChart[];
}

const NO_CHARTS: SheetCharts = { view: undefined, charts: [] };

function chartsOf(doc: Y.Doc, sheetId: string | undefined): ResolvedChart[] {
  if (sheetId === undefined) {
    return [];
  }
  const sheet = readSheet(doc, sheetId);
  return sheet === undefined ? [] : readCharts(sheet);
}

function movesCharts(doc: Y.Doc, transaction: Y.Transaction): boolean {
  const changes = emptyChanges();
  collectChanges(doc, transaction, changes);
  if (changes.sheets) {
    return true;
  }
  for (const sheet of changes.bySheet.values()) {
    if (sheet.rules || sheet.rowOrder || sheet.columnOrder) {
      return true;
    }
  }
  return false;
}

export function useSheetCharts(
  source: ChartViewSource | undefined,
  doc: Y.Doc,
  layer: RefObject<HTMLElement | null>,
): SheetCharts {
  const [state, setState] = useState<SheetCharts>(NO_CHARTS);

  useEffect(() => {
    if (source === undefined) {
      setState(NO_CHARTS);
      return;
    }
    let frame: number | undefined;
    let sheetId = source.activeSheetId();
    let charts: PlacedChart[] = [];
    let readCharts = true;
    let dataChanged = true;

    const draw = () => {
      frame = undefined;
      const activeSheetId = source.activeSheetId();
      if (readCharts || dataChanged || activeSheetId !== sheetId) {
        sheetId = activeSheetId;
        charts = chartsOf(doc, sheetId).map((chart) => ({
          chart,
          values: sheetId === undefined ? [] : source.values(sheetId, chart.source),
        }));
      }
      readCharts = false;
      dataChanged = false;
      const element = layer.current;
      setState({ view: element === null ? undefined : source.read(element), charts });
    };

    const schedule = () => {
      if (frame === undefined) {
        frame = requestAnimationFrame(draw);
      }
    };

    const onTransaction = (transaction: Y.Transaction) => {
      if (movesCharts(doc, transaction)) {
        readCharts = true;
        schedule();
      }
    };

    doc.on('afterTransaction', onTransaction);
    const unsubscribe = source.subscribe(schedule, () => {
      dataChanged = true;
      schedule();
    });
    schedule();

    return () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      doc.off('afterTransaction', onTransaction);
      unsubscribe();
    };
  }, [source, doc, layer]);

  return state;
}
