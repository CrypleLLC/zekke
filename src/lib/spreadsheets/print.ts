import type { PageMargins, PageOrientation, PaperSize } from '@/lib/document-page';
import { LEGACY_PAGE_MARGINS } from '@/lib/document-page';
import { readAxis } from './axis';
import { SHEET_PAGE_SETUP, type Dimension, type SheetMap } from './layout';
import { RANGE_TYPE_COLUMN, RANGE_TYPE_ROW, type GridRange } from './ranges';
import { readRules, removeRule, writeRule } from './rules';
import { writeSheetProperty } from './sheets';

export type PrintScale = 'actual' | 'width' | 'page';
export type MarginPreset = 'normal' | 'narrow' | 'wide';
export type PageOrder = 'down' | 'over';

export const PRINT_SCALES: readonly PrintScale[] = ['actual', 'width', 'page'];
export const MARGIN_PRESETS: readonly MarginPreset[] = ['normal', 'narrow', 'wide'];
export const PAGE_ORDERS: readonly PageOrder[] = ['down', 'over'];

export const MARGIN_PRESET_SIZES: Record<MarginPreset, PageMargins> = {
  normal: { top: 20, right: 18, bottom: 20, left: 18 },
  narrow: { top: 12.7, right: 6.4, bottom: 12.7, left: 6.4 },
  wide: LEGACY_PAGE_MARGINS,
};

export interface PageSetup {
  paper: PaperSize;
  orientation: PageOrientation;
  scale: PrintScale;
  margins: MarginPreset;
  gridlines: boolean;
  order: PageOrder;
}

export const PAGE_SETUP_STORED_BYTES = 200;
export const PRINT_AREA_RULE = 'print:area';
export const PRINT_TITLE_RULES: Record<Dimension, string> = { rows: 'print:rows', columns: 'print:columns' };
export const PRINT_AREA_FEATURE = 'print-area';
export const PRINT_TITLES_FEATURE = 'print-titles';
export const PAGE_BREAK_FEATURE = 'page-break';

export function defaultPageSetup(paper: PaperSize): PageSetup {
  return { paper, orientation: 'portrait', scale: 'actual', margins: 'normal', gridlines: true, order: 'down' };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function readPageSetup(sheet: SheetMap, defaultPaper: PaperSize): PageSetup {
  const stored = sheet.get(SHEET_PAGE_SETUP);
  const record = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, unknown>;
  const fallback = defaultPageSetup(defaultPaper);
  return {
    paper: oneOf<PaperSize>(record.paper, ['a4', 'letter'], fallback.paper),
    orientation: oneOf<PageOrientation>(record.orientation, ['portrait', 'landscape'], fallback.orientation),
    scale: oneOf(record.scale, PRINT_SCALES, fallback.scale),
    margins: oneOf(record.margins, MARGIN_PRESETS, fallback.margins),
    gridlines: typeof record.gridlines === 'boolean' ? record.gridlines : fallback.gridlines,
    order: oneOf(record.order, PAGE_ORDERS, fallback.order),
  };
}

export function writePageSetup(sheet: SheetMap, setup: PageSetup, origin?: unknown): void {
  writeSheetProperty(sheet, SHEET_PAGE_SETUP, { ...setup }, origin);
}

export interface LineSpan {
  start: number;
  end: number;
}

export interface CellArea {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

export interface PrintSettings {
  area: CellArea | undefined;
  titleRows: LineSpan | undefined;
  titleColumns: LineSpan | undefined;
  rowBreaks: number[];
  columnBreaks: number[];
}

export function readPrintSettings(sheet: SheetMap): PrintSettings {
  const settings: PrintSettings = {
    area: undefined,
    titleRows: undefined,
    titleColumns: undefined,
    rowBreaks: [],
    columnBreaks: [],
  };
  const rowBreaks = new Set<number>();
  const columnBreaks = new Set<number>();
  for (const rule of readRules(sheet)) {
    const range = rule.ranges[0];
    if (rule.feature === PRINT_AREA_FEATURE && rule.id === PRINT_AREA_RULE && !range.wholeRows && !range.wholeColumns) {
      settings.area = {
        startRow: range.startRow,
        endRow: range.endRow,
        startColumn: range.startColumn,
        endColumn: range.endColumn,
      };
    } else if (rule.feature === PRINT_TITLES_FEATURE && rule.id === PRINT_TITLE_RULES.rows && range.wholeRows) {
      settings.titleRows = { start: range.startRow, end: range.endRow };
    } else if (rule.feature === PRINT_TITLES_FEATURE && rule.id === PRINT_TITLE_RULES.columns && range.wholeColumns) {
      settings.titleColumns = { start: range.startColumn, end: range.endColumn };
    } else if (rule.feature === PAGE_BREAK_FEATURE && range.wholeRows && range.startRow > 0) {
      rowBreaks.add(range.startRow);
    } else if (rule.feature === PAGE_BREAK_FEATURE && range.wholeColumns && range.startColumn > 0) {
      columnBreaks.add(range.startColumn);
    }
  }
  settings.rowBreaks = [...rowBreaks].sort((a, b) => a - b);
  settings.columnBreaks = [...columnBreaks].sort((a, b) => a - b);
  return settings;
}

export function writePrintArea(sheet: SheetMap, area: CellArea | undefined, origin?: unknown): void {
  if (area === undefined) {
    removeRule(sheet, PRINT_AREA_RULE, origin);
    return;
  }
  writeRule(sheet, { id: PRINT_AREA_RULE, feature: PRINT_AREA_FEATURE, ranges: [area], body: {} }, origin);
}

function lineRange(dimension: Dimension, span: LineSpan): GridRange {
  return dimension === 'rows'
    ? { startRow: span.start, endRow: span.end, startColumn: 0, endColumn: 0, rangeType: RANGE_TYPE_ROW }
    : { startRow: 0, endRow: 0, startColumn: span.start, endColumn: span.end, rangeType: RANGE_TYPE_COLUMN };
}

export function writePrintTitles(
  sheet: SheetMap,
  dimension: Dimension,
  span: LineSpan | undefined,
  origin?: unknown,
): void {
  const id = PRINT_TITLE_RULES[dimension];
  if (span === undefined) {
    removeRule(sheet, id, origin);
    return;
  }
  writeRule(sheet, { id, feature: PRINT_TITLES_FEATURE, ranges: [lineRange(dimension, span)], body: {} }, origin);
}

function breakRuleIds(sheet: SheetMap, dimension: Dimension, index: number): string[] {
  return readRules(sheet, PAGE_BREAK_FEATURE)
    .filter(({ ranges: [range] }) =>
      dimension === 'rows'
        ? range.wholeRows && range.startRow === index
        : range.wholeColumns && range.startColumn === index,
    )
    .map(({ id }) => id);
}

export function hasPageBreak(sheet: SheetMap, dimension: Dimension, index: number): boolean {
  return breakRuleIds(sheet, dimension, index).length > 0;
}

export function addPageBreak(sheet: SheetMap, dimension: Dimension, index: number, origin?: unknown): boolean {
  if (index <= 0 || index >= readAxis(sheet, dimension).size || hasPageBreak(sheet, dimension, index)) {
    return false;
  }
  writeRule(
    sheet,
    { feature: PAGE_BREAK_FEATURE, ranges: [lineRange(dimension, { start: index, end: index })], body: {} },
    origin,
  );
  return true;
}

export function removePageBreak(sheet: SheetMap, dimension: Dimension, index: number, origin?: unknown): void {
  for (const id of breakRuleIds(sheet, dimension, index)) {
    removeRule(sheet, id, origin);
  }
}

export function clearPageBreaks(sheet: SheetMap, origin?: unknown): void {
  for (const { id } of readRules(sheet, PAGE_BREAK_FEATURE)) {
    removeRule(sheet, id, origin);
  }
}
