import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  PrintGrid,
  SHEET_PAGE_SETUP,
  addPageBreak,
  cellLook,
  clearPageBreaks,
  createSheet,
  defaultPageSetup,
  insertLines,
  layoutPrint,
  markSpreadsheet,
  pageRegions,
  readPageSetup,
  readPrintSettings,
  readSheet,
  regionCells,
  regionCharts,
  regionGridlines,
  removeLines,
  removePageBreak,
  safeCellFont,
  writePageSetup,
  writePrintArea,
  writePrintTitles,
  type PageSetup,
  type PrintCell,
  type SheetMap,
} from './index';
import { defaultPaperFor, paperPageRule, pixelsFromMillimetres } from '@/lib/document-page';

function workbook(): { doc: Y.Doc; sheet: SheetMap } {
  const doc = new Y.Doc();
  markSpreadsheet(doc);
  const sheet = readSheet(doc, createSheet(doc, { name: 'Sheet1', rows: 100, columns: 20 })) as SheetMap;
  return { doc, sheet };
}

function pair(): { a: SheetMap; b: SheetMap; sync(): void } {
  const first = workbook();
  const second = new Y.Doc();
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first.doc));
  const sheetId = [...second.getMap('sheets').keys()][0];
  return {
    a: first.sheet,
    b: readSheet(second, sheetId) as SheetMap,
    sync() {
      Y.applyUpdate(second, Y.encodeStateAsUpdate(first.doc, Y.encodeStateVector(second)));
      Y.applyUpdate(first.doc, Y.encodeStateAsUpdate(second, Y.encodeStateVector(first.doc)));
    },
  };
}

const NO_TITLES = { titleRows: undefined, titleColumns: undefined, rowBreaks: [], columnBreaks: [] };

function setup(overrides: Partial<PageSetup> = {}): PageSetup {
  return { ...defaultPageSetup('a4'), ...overrides };
}

function grid(rows: number, columns: number, rowSize = 20, columnSize = 100): PrintGrid {
  return new PrintGrid(Array(rows).fill(rowSize), Array(columns).fill(columnSize));
}

describe('the page setup in the CRDT', () => {
  it('defaults when nothing is stored, with the paper of the locale', () => {
    const { sheet } = workbook();
    expect(readPageSetup(sheet, 'letter')).toEqual(defaultPageSetup('letter'));
    expect(defaultPaperFor('en-US')).toBe('letter');
    expect(defaultPaperFor('pt-BR')).toBe('a4');
    expect(defaultPaperFor('en')).toBe('a4');
    expect(defaultPaperFor(undefined)).toBe('a4');
  });

  it('round-trips, and replaces each unreadable field with its default', () => {
    const { sheet } = workbook();
    const stored = setup({ paper: 'letter', orientation: 'landscape', scale: 'width', margins: 'narrow', gridlines: false, order: 'over' });
    writePageSetup(sheet, stored);
    expect(readPageSetup(sheet, 'a4')).toEqual(stored);
    sheet.set(SHEET_PAGE_SETUP, { paper: 'a3', orientation: 7, scale: 'page', gridlines: 'yes' });
    expect(readPageSetup(sheet, 'a4')).toEqual(setup({ scale: 'page' }));
  });
});

describe('the print area, titles and breaks in the CRDT', () => {
  it('reads nothing on a fresh sheet', () => {
    const { sheet } = workbook();
    expect(readPrintSettings(sheet)).toEqual({ area: undefined, ...NO_TITLES });
  });

  it('keeps the print area on its cells when rows are inserted above it on another device', () => {
    const { a, b, sync } = pair();
    writePrintArea(a, { startRow: 2, endRow: 9, startColumn: 1, endColumn: 4 });
    insertLines(b, 'rows', 0, 3);
    sync();
    expect(readPrintSettings(a).area).toEqual({ startRow: 5, endRow: 12, startColumn: 1, endColumn: 4 });
    expect(readPrintSettings(b).area).toEqual(readPrintSettings(a).area);
  });

  it('clears the print area', () => {
    const { sheet } = workbook();
    writePrintArea(sheet, { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 });
    writePrintArea(sheet, undefined);
    expect(readPrintSettings(sheet).area).toBeUndefined();
  });

  it('stores repeated rows and columns as whole lines, which follow insertions', () => {
    const { sheet } = workbook();
    writePrintTitles(sheet, 'rows', { start: 0, end: 1 });
    writePrintTitles(sheet, 'columns', { start: 0, end: 0 });
    insertLines(sheet, 'rows', 1, 1);
    expect(readPrintSettings(sheet)).toMatchObject({ titleRows: { start: 0, end: 2 }, titleColumns: { start: 0, end: 0 } });
    writePrintTitles(sheet, 'rows', undefined);
    expect(readPrintSettings(sheet).titleRows).toBeUndefined();
  });

  it('adds a break once, refuses one before the first line, and moves it with its row', () => {
    const { sheet } = workbook();
    expect(addPageBreak(sheet, 'rows', 10)).toBe(true);
    expect(addPageBreak(sheet, 'rows', 10)).toBe(false);
    expect(addPageBreak(sheet, 'rows', 0)).toBe(false);
    expect(addPageBreak(sheet, 'columns', 3)).toBe(true);
    insertLines(sheet, 'rows', 0, 2);
    expect(readPrintSettings(sheet)).toMatchObject({ rowBreaks: [12], columnBreaks: [3] });
    removePageBreak(sheet, 'rows', 12);
    expect(readPrintSettings(sheet).rowBreaks).toEqual([]);
    clearPageBreaks(sheet);
    expect(readPrintSettings(sheet).columnBreaks).toEqual([]);
  });

  it('drops a break whose row was removed, and merges the same break made on two devices', () => {
    const { a, b, sync } = pair();
    addPageBreak(a, 'rows', 5);
    addPageBreak(b, 'rows', 5);
    addPageBreak(a, 'rows', 20);
    sync();
    expect(readPrintSettings(b).rowBreaks).toEqual([5, 20]);
    removeLines(b, 'rows', 20, 1);
    sync();
    expect(readPrintSettings(a).rowBreaks).toEqual([5]);
    removePageBreak(a, 'rows', 5);
    sync();
    expect(readPrintSettings(b).rowBreaks).toEqual([]);
  });
});

describe('the page rule', () => {
  it('names the paper, the orientation and the margins', () => {
    expect(paperPageRule('letter', 'landscape', { top: 20, right: 18, bottom: 20, left: 18 })).toBe(
      '@page { size: letter landscape; margin: 20mm 18mm 20mm 18mm; }',
    );
  });
});

describe('pagination', () => {
  const portrait = setup();
  const contentWidth = pixelsFromMillimetres(210 - 36);
  const contentHeight = pixelsFromMillimetres(297 - 40);

  it('fills each page down, then over, at actual size', () => {
    const layout = layoutPrint(grid(100, 20), { startRow: 0, endRow: 99, startColumn: 0, endColumn: 19 }, NO_TITLES, portrait);
    const rowsPerPage = Math.floor(contentHeight / 20);
    const columnsPerPage = Math.floor(contentWidth / 100);
    expect(layout.scale).toBe(1);
    expect(layout.content.width).toBeCloseTo(contentWidth);
    expect(layout.pages[0]).toEqual({ rows: { start: 0, end: rowsPerPage - 1 }, columns: { start: 0, end: columnsPerPage - 1 } });
    expect(layout.pages[1].rows.start).toBe(rowsPerPage);
    expect(layout.pages[1].columns.start).toBe(0);
    expect(layout.totalPages).toBe(Math.ceil(100 / rowsPerPage) * Math.ceil(20 / columnsPerPage));
  });

  it('goes over, then down, when asked', () => {
    const layout = layoutPrint(grid(100, 20), { startRow: 0, endRow: 99, startColumn: 0, endColumn: 19 }, NO_TITLES, setup({ order: 'over' }));
    expect(layout.pages[1].rows.start).toBe(0);
    expect(layout.pages[1].columns.start).toBeGreaterThan(0);
  });

  it('lays a landscape page out on the long side', () => {
    const layout = layoutPrint(grid(10, 10), { startRow: 0, endRow: 9, startColumn: 0, endColumn: 9 }, NO_TITLES, setup({ orientation: 'landscape' }));
    expect(layout.paper).toEqual({ width: 297, height: 210 });
    expect(layout.pages[0].columns.end).toBe(Math.floor(pixelsFromMillimetres(297 - 36) / 100) - 1);
  });

  it('fits every column on one page wide, scaling down only', () => {
    const wide = layoutPrint(grid(200, 20), { startRow: 0, endRow: 199, startColumn: 0, endColumn: 19 }, NO_TITLES, setup({ scale: 'width' }));
    expect(wide.scale).toBeCloseTo(contentWidth / 2000, 3);
    expect(new Set(wide.pages.map((page) => page.columns.start))).toEqual(new Set([0]));
    expect(wide.pages.length).toBeGreaterThan(1);
    const narrow = layoutPrint(grid(5, 2), { startRow: 0, endRow: 4, startColumn: 0, endColumn: 1 }, NO_TITLES, setup({ scale: 'width' }));
    expect(narrow.scale).toBe(1);
  });

  it('fits the whole area on one page, never below 10 %', () => {
    const fitted = layoutPrint(grid(200, 20), { startRow: 0, endRow: 199, startColumn: 0, endColumn: 19 }, NO_TITLES, setup({ scale: 'page' }));
    expect(fitted.pages).toHaveLength(1);
    expect(fitted.scale).toBeCloseTo(Math.min(contentWidth / 2000, contentHeight / 4000), 3);
    const huge = layoutPrint(grid(5000, 20), { startRow: 0, endRow: 4999, startColumn: 0, endColumn: 19 }, NO_TITLES, setup({ scale: 'page' }));
    expect(huge.scale).toBe(0.1);
    expect(huge.pages.length).toBeGreaterThan(1);
  });

  it('breaks where the person asked, and ignores the breaks a fit overrides', () => {
    const settings = { ...NO_TITLES, rowBreaks: [10, 30], columnBreaks: [1] };
    const area = { startRow: 0, endRow: 39, startColumn: 0, endColumn: 2 };
    const actual = layoutPrint(grid(40, 3), area, settings, portrait);
    expect(actual.pages.map((page) => [page.rows.start, page.columns.start])).toEqual([
      [0, 0],
      [10, 0],
      [30, 0],
      [0, 1],
      [10, 1],
      [30, 1],
    ]);
    expect(layoutPrint(grid(40, 3), area, settings, setup({ scale: 'width' })).pages.map((page) => page.rows.start)).toEqual([0, 10, 30]);
    expect(layoutPrint(grid(40, 3), area, settings, setup({ scale: 'page' })).pages).toHaveLength(1);
  });

  it('repeats the title rows on the pages that come after them, and leaves room for them', () => {
    const settings = { ...NO_TITLES, titleRows: { start: 0, end: 1 } };
    const layout = layoutPrint(grid(300, 2), { startRow: 0, endRow: 299, startColumn: 0, endColumn: 1 }, settings, portrait);
    const perPage = Math.floor(contentHeight / 20);
    expect(layout.pages[0].titleRows).toBeUndefined();
    expect(layout.pages[0].rows.end).toBe(perPage - 1);
    expect(layout.pages[1].titleRows).toEqual({ start: 0, end: 1 });
    expect(layout.pages[1].rows.end - layout.pages[1].rows.start + 1).toBe(perPage - 2);
  });

  it('repeats title columns on every page when they sit left of the area', () => {
    const settings = { ...NO_TITLES, titleColumns: { start: 0, end: 0 } };
    const layout = layoutPrint(grid(10, 30), { startRow: 0, endRow: 9, startColumn: 2, endColumn: 29 }, settings, portrait);
    expect(layout.pages.every((page) => page.titleColumns?.start === 0)).toBe(true);
    expect(layout.pages[0].columns.end - layout.pages[0].columns.start + 1).toBe(Math.floor((contentWidth - 100) / 100));
  });

  it('skips hidden lines and gives a line taller than a page a page of its own', () => {
    const rows = Array(10).fill(20);
    rows[3] = 0;
    rows[6] = 5000;
    const layout = layoutPrint(new PrintGrid(rows, [100]), { startRow: 0, endRow: 9, startColumn: 0, endColumn: 0 }, NO_TITLES, portrait);
    expect(layout.pages.map((page) => page.rows)).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 6 },
      { start: 7, end: 9 },
    ]);
  });

  it('stops at the page limit and says how many there would have been', () => {
    const layout = layoutPrint(grid(20000, 40), { startRow: 0, endRow: 19999, startColumn: 0, endColumn: 39 }, NO_TITLES, portrait);
    expect(layout.pages).toHaveLength(250);
    expect(layout.totalPages).toBeGreaterThan(250);
  });

  it('clamps the area to the sheet, and prints nothing outside it', () => {
    expect(layoutPrint(grid(5, 5), { startRow: 3, endRow: 50, startColumn: 0, endColumn: 2 }, NO_TITLES, portrait).pages[0].rows).toEqual({ start: 3, end: 4 });
    expect(layoutPrint(grid(5, 5), { startRow: 9, endRow: 50, startColumn: 0, endColumn: 2 }, NO_TITLES, portrait).pages).toEqual([]);
  });
});

describe('a page laid out', () => {
  function text(value: string, horizontal: PrintCell['horizontal'] = 'left', extra: Partial<PrintCell> = {}): PrintCell {
    return { text: value, numeric: false, horizontal, wrap: false, decorated: false, ...extra };
  }

  it('places the titles, then the body, in four regions', () => {
    const regions = pageRegions(grid(50, 10), {
      rows: { start: 20, end: 29 },
      columns: { start: 5, end: 7 },
      titleRows: { start: 0, end: 1 },
      titleColumns: { start: 0, end: 0 },
    });
    expect(regions.map(({ kind, left, top, width, height }) => [kind, left, top, width, height])).toEqual([
      ['corner', 0, 0, 100, 40],
      ['top', 100, 0, 300, 40],
      ['left', 0, 40, 100, 200],
      ['body', 100, 40, 300, 200],
    ]);
  });

  it('lets text run into empty neighbours, the way the grid draws it', () => {
    const cells = new Map<string, PrintCell>([
      ['0:0', text('A long heading')],
      ['1:2', text('right', 'right')],
      ['2:1', text('centred', 'center')],
      ['3:0', text('blocked')],
      ['3:1', text('x')],
      ['4:0', text('12345', 'right', { numeric: true })],
      ['5:0', text('wrapped', 'left', { wrap: true })],
    ]);
    const [region] = pageRegions(grid(10, 4), { rows: { start: 0, end: 9 }, columns: { start: 0, end: 3 } });
    const placed = regionCells(grid(10, 4), region, (row, column) => cells.get(`${row}:${column}`), []);
    const textOf = (row: number, column: number) => placed.find((cell) => cell.row === row && cell.column === column)?.text;
    expect(textOf(0, 0)).toEqual({ left: 0, top: 0, width: 400, height: 20 });
    expect(textOf(1, 2)).toEqual({ left: 0, top: 20, width: 300, height: 20 });
    expect(textOf(2, 1)).toEqual({ left: 0, top: 40, width: 300, height: 20 });
    expect(textOf(3, 0)?.width).toBe(100);
    expect(textOf(4, 0)?.width).toBe(100);
    expect(textOf(5, 0)?.width).toBe(100);
  });

  it('draws a merge once, from its first cell, even when it starts on an earlier page', () => {
    const cells = new Map<string, PrintCell>([['2:1', text('Merged', 'center')]]);
    const g = grid(20, 6);
    const [region] = pageRegions(g, { rows: { start: 4, end: 9 }, columns: { start: 0, end: 5 } });
    const placed = regionCells(g, region, (row, column) => cells.get(`${row}:${column}`), [
      { startRow: 2, endRow: 6, startColumn: 1, endColumn: 3 },
    ]);
    expect(placed).toHaveLength(1);
    expect(placed[0].box).toEqual({ left: 100, top: -40, width: 300, height: 100 });
  });

  it('draws gridlines on every visible line, and charts that reach into the region', () => {
    const rows = Array(5).fill(20);
    rows[2] = 0;
    const g = new PrintGrid(rows, [100, 100]);
    const [region] = pageRegions(g, { rows: { start: 1, end: 4 }, columns: { start: 0, end: 1 } });
    expect(regionGridlines(g, region)).toEqual({ xs: [0, 100, 200], ys: [0, 20, 40, 60] });
    const charts = regionCharts(g, region, [
      { id: 'in', rect: { left: 50, top: 30, width: 300, height: 300 } },
      { id: 'out', rect: { left: 0, top: 100, width: 50, height: 50 } },
      { id: 'above', rect: { left: 0, top: 0, width: 50, height: 10 } },
    ]);
    expect(charts.map(({ id, box }) => [id, box.left, box.top])).toEqual([['in', 50, 10]]);
  });
});

describe('a cell style for print', () => {
  it('reads Univer’s style, with the grid’s defaults', () => {
    expect(cellLook({}, 'number')).toMatchObject({ fontFamily: '"Arial", sans-serif', fontSize: 11, horizontal: 'right', vertical: 'bottom', wrap: false });
    expect(cellLook({}, 'boolean').horizontal).toBe('center');
    const look = cellLook(
      {
        ff: 'Times New Roman',
        fs: 14,
        bl: 1,
        it: 1,
        ul: { s: 1 },
        st: { s: 0 },
        cl: { rgb: '#ff0000' },
        bg: { rgb: 'rgb(1, 2, 3)' },
        ht: 2,
        vt: 1,
        tb: 3,
        bd: { t: { s: 1, cl: { rgb: '#00ff00' } }, b: { s: 7 }, l: { s: 0 } },
      },
      'text',
    );
    expect(look).toMatchObject({
      fontFamily: '"Times New Roman", sans-serif',
      fontSize: 14,
      bold: true,
      italic: true,
      underline: true,
      strike: false,
      color: '#ff0000',
      background: 'rgb(1, 2, 3)',
      horizontal: 'center',
      vertical: 'top',
      wrap: true,
      borders: { top: { width: 1, style: 'solid', color: '#00ff00' }, bottom: { width: 3, style: 'double', color: '#000000' } },
    });
  });

  it('never lets a stored value reach the page as anything but a colour or a font name', () => {
    const look = cellLook({ cl: { rgb: 'url(https://example.com/x)' }, bg: { rgb: 'red;background:url(x)' }, ff: 'x"); background: url(y' }, 'text');
    expect(look.color).toBe('#000000');
    expect(look.background).toBeUndefined();
    expect(look.fontFamily).toBe('"Arial", sans-serif');
    expect(safeCellFont('Calibri, "Segoe UI", sans-serif')).toBe('"Calibri", "Segoe UI", sans-serif');
  });
});
