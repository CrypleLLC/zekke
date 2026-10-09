'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type * as Y from 'yjs';
import { PRINT_LABELS } from '@/lib/app';
import { paperPageRule, pixelsFromMillimetres, type PaperSize } from '@/lib/document-page';
import { useRegionalPreferences } from '@/components/session/usePreferences';
import {
  PAGE_SETUP_STORED_BYTES,
  layoutPrint,
  pageRegions,
  readPageSetup,
  readPrintSettings,
  readSheet,
  regionCells,
  regionCharts,
  regionGridlines,
  regionMerges,
  type BorderSide,
  type GridRange,
  type PageRegion,
  type PageSetup,
  type PlacedCell,
  type PrintLayout,
  type PrintPage,
  type PrintSettings,
  type SheetMap,
} from '@/lib/spreadsheets';
import { Notice } from '@/components/ui';
import type { SpreadsheetBinding } from './binding';
import PrintPanel from './PrintPanel';
import { printedText, type SheetPrint as SheetPrintData, type SheetPrintCell, type SheetPrintReader } from './print-source';

const GRIDLINE_COLOR = '#d4d4d4';
const PREVIEW_GUTTER = 48;
const REFRESH_DELAY_MS = 120;

export interface PrintModel {
  setup: PageSetup;
  settings: PrintSettings;
  source: SheetPrintData;
  layout: PrintLayout | undefined;
}

function readModel(doc: Y.Doc, sheetId: string, reader: SheetPrintReader, paper: PaperSize): PrintModel | undefined {
  const sheet = readSheet(doc, sheetId);
  const source = reader.read(doc, sheetId);
  if (sheet === undefined || source === undefined) {
    return undefined;
  }
  const setup = readPageSetup(sheet, paper);
  const settings = readPrintSettings(sheet);
  const area = settings.area ?? source.contentArea;
  return { setup, settings, source, layout: area === undefined ? undefined : layoutPrint(source.grid, area, settings, setup) };
}

export default function SheetPrint({
  doc,
  sheetId,
  reader,
  binding,
  selection,
  onClose,
}: {
  doc: Y.Doc;
  sheetId: string;
  reader: SheetPrintReader;
  binding: SpreadsheetBinding;
  selection: GridRange | undefined;
  onClose: () => void;
}) {
  const { regional } = useRegionalPreferences();
  const paper = regional.paper;
  const [model, setModel] = useState(() => readModel(doc, sheetId, reader, paper));
  const [zoom, setZoom] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const stack = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setModel(readModel(doc, sheetId, reader, paper)), REFRESH_DELAY_MS);
    };
    doc.on('afterTransaction', refresh);
    refresh();
    return () => {
      clearTimeout(timer);
      doc.off('afterTransaction', refresh);
    };
  }, [doc, sheetId, reader, paper]);

  const paperWidth = model?.layout?.paper.width;
  useEffect(() => {
    const element = scroller.current;
    if (element === null || paperWidth === undefined) {
      return;
    }
    const measure = () => {
      const available = element.clientWidth - PREVIEW_GUTTER;
      setZoom(Math.max(0.2, Math.min(1, available / pixelsFromMillimetres(paperWidth))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [paperWidth]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const edit = useCallback(
    (change: (sheet: SheetMap) => void) => {
      binding.editSheet(sheetId, PAGE_SETUP_STORED_BYTES, change);
    },
    [binding, sheetId],
  );

  const print = useCallback(async () => {
    const images = [...(stack.current?.querySelectorAll('img') ?? [])];
    await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
    window.print();
  }, []);

  if (model === undefined) {
    return null;
  }
  const { layout, setup, source } = model;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={PRINT_LABELS.preview}
      translate="no"
      className="zekke-sheet-print notranslate fixed inset-0 z-50 flex bg-ground"
    >
      {layout !== undefined ? <style>{paperPageRule(setup.paper, setup.orientation, layout.margins)}</style> : null}
      <div ref={scroller} className="zekke-print-scroller min-w-0 flex-1 overflow-auto px-6 py-6">
        {layout === undefined || layout.pages.length === 0 ? (
          <div className="zekke-no-print mx-auto max-w-md">
            <Notice tone="info">{PRINT_LABELS.nothing}</Notice>
          </div>
        ) : (
          <div
            ref={stack}
            className="zekke-print-stack flex flex-col items-center gap-6"
            style={{ '--print-zoom': zoom } as CSSProperties}
          >
            {layout.pages.map((page, index) => (
              <PrintedPage key={index} number={index + 1} layout={layout} page={page} source={source} gridlines={setup.gridlines} />
            ))}
          </div>
        )}
      </div>
      <PrintPanel
        model={model}
        selection={selection}
        onEdit={edit}
        onPrint={() => void print()}
        onClose={onClose}
      />
    </div>,
    document.body,
  );
}

function PrintedPage({
  number,
  layout,
  page,
  source,
  gridlines,
}: {
  number: number;
  layout: PrintLayout;
  page: PrintPage;
  source: SheetPrintData;
  gridlines: boolean;
}) {
  const { paper, margins, content, scale } = layout;
  const contentWidth = paper.width - margins.left - margins.right;
  const contentHeight = paper.height - margins.top - margins.bottom;
  return (
    <section
      aria-label={`${PRINT_LABELS.page} ${number}`}
      className="zekke-print-paper shrink-0 bg-white shadow-lift"
      style={
        {
          width: `${paper.width}mm`,
          height: `${paper.height}mm`,
          padding: `${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm`,
          '--print-content-w': `${contentWidth}mm`,
          '--print-content-h': `${contentHeight}mm`,
        } as CSSProperties
      }
    >
      <div className="relative h-full w-full overflow-hidden">
        <div
          className="absolute left-0 top-0"
          style={{
            width: content.width / scale,
            height: content.height / scale,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          {pageRegions(source.grid, page).map((region) => (
            <PrintedRegion key={region.kind} region={region} source={source} gridlines={gridlines} />
          ))}
        </div>
      </div>
    </section>
  );
}

function PrintedRegion({ region, source, gridlines }: { region: PageRegion; source: SheetPrintData; gridlines: boolean }) {
  const { grid } = source;
  const placed = regionCells(grid, region, source.cellAt, source.merges);
  const lines = gridlines ? regionGridlines(grid, region) : undefined;
  const charts = region.kind === 'body' ? regionCharts(grid, region, source.charts) : [];

  return (
    <div
      className="absolute overflow-hidden"
      style={{ left: region.left, top: region.top, width: region.width, height: region.height }}
    >
      {lines?.xs.map((x) => (
        <div key={`x${x}`} className="absolute top-0" style={{ left: x - 0.5, height: region.height, borderLeft: `1px solid ${GRIDLINE_COLOR}` }} />
      ))}
      {lines?.ys.map((y) => (
        <div key={`y${y}`} className="absolute left-0" style={{ top: y - 0.5, width: region.width, borderTop: `1px solid ${GRIDLINE_COLOR}` }} />
      ))}
      {lines === undefined
        ? null
        : regionMerges(grid, region, source.merges).map((rect) => (
            <div
              key={`m${rect.left}:${rect.top}`}
              className="absolute bg-white"
              style={{ left: rect.left + 0.5, top: rect.top + 0.5, width: Math.max(0, rect.width - 1), height: Math.max(0, rect.height - 1) }}
            />
          ))}
      {placed.map((cell) =>
        cell.cell.look.background === undefined ? null : (
          <div
            key={`f${cell.row}:${cell.column}`}
            className="absolute"
            style={{ left: cell.box.left, top: cell.box.top, width: cell.box.width, height: cell.box.height, background: cell.cell.look.background }}
          />
        ),
      )}
      {placed.map((cell) => (cell.cell.text === '' ? null : <PrintedText key={`t${cell.row}:${cell.column}`} placed={cell} />))}
      {placed.flatMap((cell) => borderLines(cell))}
      {charts.map((chart) => (
        <img
          key={chart.id}
          alt=""
          src={chart.url}
          className="absolute max-w-none"
          style={{ left: chart.box.left, top: chart.box.top, width: chart.box.width, height: chart.box.height }}
        />
      ))}
    </div>
  );
}

const JUSTIFY: Record<string, CSSProperties['justifyContent']> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
  justify: 'flex-start',
};

const ALIGN: Record<string, CSSProperties['alignItems']> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

function PrintedText({ placed }: { placed: PlacedCell<SheetPrintCell> }) {
  const { cell, text: rect, box } = placed;
  const { look } = cell;
  const decoration = [look.underline ? 'underline' : '', look.strike ? 'line-through' : ''].filter(Boolean).join(' ');
  return (
    <div
      className="absolute flex overflow-hidden"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        padding: `${look.padding.top}px ${look.padding.right}px ${look.padding.bottom}px ${look.padding.left}px`,
        justifyContent: JUSTIFY[look.horizontal],
        alignItems: ALIGN[look.vertical],
        textAlign: look.horizontal === 'justify' ? 'justify' : look.horizontal,
        fontFamily: look.fontFamily,
        fontSize: `${look.fontSize}pt`,
        fontWeight: look.bold ? 700 : 400,
        fontStyle: look.italic ? 'italic' : 'normal',
        textDecoration: decoration === '' ? 'none' : decoration,
        color: look.color,
        lineHeight: 1.2,
        whiteSpace: look.wrap ? 'pre-wrap' : 'pre',
        overflowWrap: look.wrap ? 'anywhere' : 'normal',
      }}
    >
      <span className={look.wrap || look.horizontal === 'justify' ? 'min-w-0 flex-1' : 'shrink-0'}>{printedText(cell, box.width)}</span>
    </div>
  );
}

function borderLines(placed: PlacedCell<SheetPrintCell>) {
  const { box } = placed;
  return (Object.entries(placed.cell.look.borders) as [BorderSide, { width: number; style: string; color: string }][]).map(
    ([side, line]) => {
      const stroke = `${line.width}px ${line.style} ${line.color}`;
      const half = line.width / 2;
      const style: CSSProperties =
        side === 'top' || side === 'bottom'
          ? { left: box.left - half, top: (side === 'top' ? box.top : box.top + box.height) - half, width: box.width + line.width, borderTop: stroke }
          : { top: box.top - half, left: (side === 'left' ? box.left : box.left + box.width) - half, height: box.height + line.width, borderLeft: stroke };
      return <div key={`b${placed.row}:${placed.column}:${side}`} className="absolute" style={style} />;
    },
  );
}
