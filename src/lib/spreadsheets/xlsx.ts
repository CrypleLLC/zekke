import type { ICellData, IRange, IStyleData, IWorkbookData, IWorksheetData, LocaleType } from '@univerjs/core';
import type * as ExcelJSNamespace from 'exceljs';
import { CELL_BOOLEAN, CELL_FORCE_STRING, CELL_NUMBER, CELL_STRING } from './cells';
import { columnIndex, columnLetters } from './formulas';
import { SHEET_ID_LENGTH, randomId } from './ids';
import { DEFAULT_COLUMN_COUNT, DEFAULT_ROW_COUNT } from './sheets';
import { canonicalJson, styleId, type StyleData } from './styles';

type ExcelJS = typeof ExcelJSNamespace;
type Worksheet = ExcelJSNamespace.Worksheet;
type Cell = ExcelJSNamespace.Cell;
type Style = Partial<ExcelJSNamespace.Style>;

export type LostFeature =
  | 'comments'
  | 'images'
  | 'charts'
  | 'tables'
  | 'pivotTables'
  | 'dataValidations'
  | 'conditionalFormats'
  | 'richText'
  | 'hyperlinks'
  | 'themeColours'
  | 'arrayFormulas'
  | 'gradientFills';

export type InterchangeReport = Partial<Record<LostFeature, number>>;

export interface ImportedName {
  name: string;
  formula: string;
}

export interface ImportedWorkbook {
  workbook: IWorkbookData;
  names: ImportedName[];
  report: InterchangeReport;
}

export interface ExportedName {
  name: string;
  formula: string;
}

export const FUTURE_FUNCTIONS = [
  'XLOOKUP',
  'XMATCH',
  'FILTER',
  'SORT',
  'SORTBY',
  'UNIQUE',
  'SEQUENCE',
  'RANDARRAY',
  'IFS',
  'SWITCH',
  'MAXIFS',
  'MINIFS',
  'CONCAT',
  'TEXTJOIN',
  'LET',
  'LAMBDA',
  'TEXTBEFORE',
  'TEXTAFTER',
  'TEXTSPLIT',
  'VSTACK',
  'HSTACK',
  'TOCOL',
  'TOROW',
  'CHOOSECOLS',
  'CHOOSEROWS',
  'TAKE',
  'DROP',
  'EXPAND',
  'WRAPROWS',
  'WRAPCOLS',
  'IFNA',
  'STDEV.S',
  'STDEV.P',
  'VAR.S',
  'VAR.P',
  'CEILING.MATH',
  'FLOOR.MATH',
] as const;

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const EXCEL_1904_OFFSET_DAYS = 1462;
const DAY_MS = 86_400_000;
const PIXELS_PER_CHARACTER = 7;
const CHARACTER_PADDING_PIXELS = 5;
const POINTS_PER_PIXEL = 0.75;
const DEFAULT_FONT_SIZE = 11;
const WRAP = 3;

const VALUE = { Null: 0, Merge: 1, Number: 2, String: 3, Date: 4, Hyperlink: 5, Formula: 6, SharedString: 7, RichText: 8, Boolean: 9, Error: 10 };

const BORDER_STYLES: Record<string, number> = {
  thin: 1,
  hair: 2,
  dotted: 3,
  dashed: 4,
  dashDot: 5,
  dashDotDot: 6,
  double: 7,
  medium: 8,
  mediumDashed: 9,
  mediumDashDot: 10,
  mediumDashDotDot: 11,
  slantDashDot: 12,
  thick: 13,
};
const BORDER_NAMES = Object.fromEntries(Object.entries(BORDER_STYLES).map(([name, value]) => [value, name]));
const HORIZONTAL: Record<string, number> = { left: 1, center: 2, centerContinuous: 2, right: 3, justify: 4, fill: 1, distributed: 6 };
const HORIZONTAL_NAMES: Record<number, string> = { 1: 'left', 2: 'center', 3: 'right', 4: 'justify', 5: 'justify', 6: 'distributed' };
const VERTICAL: Record<string, number> = { top: 1, middle: 2, bottom: 3, justify: 2, distributed: 2 };
const VERTICAL_NAMES: Record<number, string> = { 1: 'top', 2: 'middle', 3: 'bottom' };
const BORDER_SIDES = [
  ['top', 't'],
  ['bottom', 'b'],
  ['left', 'l'],
  ['right', 'r'],
] as const;

async function loadExcelJS(): Promise<ExcelJS> {
  const loaded = (await import('exceljs')) as ExcelJS & { default?: ExcelJS };
  return loaded.default ?? loaded;
}

function count(report: InterchangeReport, feature: LostFeature, amount = 1): void {
  if (amount > 0) {
    report[feature] = (report[feature] ?? 0) + amount;
  }
}

function relativeTarget(from: string, target: string): string {
  const fromParts = from === '' ? [] : from.split('/');
  const targetParts = target.split('/');
  let shared = 0;
  while (shared < fromParts.length && shared < targetParts.length - 1 && fromParts[shared] === targetParts[shared]) {
    shared += 1;
  }
  return [...fromParts.slice(shared).map(() => '..'), ...targetParts.slice(shared)].join('/');
}

export async function normalisePackage(bytes: Uint8Array, report: InterchangeReport): Promise<Uint8Array> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  for (const name of Object.keys(zip.files)) {
    if (/^xl\/(comments[^/]*|comments\/[^/]+)\.xml$/.test(name)) {
      const xml = await zip.file(name)!.async('string');
      count(report, 'comments', (xml.match(/<comment\b/g) ?? []).length);
    } else if (/^xl\/charts\/chart[^/]*\.xml$/.test(name)) {
      count(report, 'charts');
    } else if (/^xl\/pivotTables\/[^/]+\.xml$/.test(name)) {
      count(report, 'pivotTables');
    } else if (/^xl\/tables\/[^/]+\.xml$/.test(name)) {
      count(report, 'tables');
    }
  }
  for (const name of Object.keys(zip.files).filter((entry) => entry.endsWith('.rels'))) {
    const folder = name.replace(/(^|\/)_rels\/[^/]+$/, '');
    const xml = (await zip.file(name)!.async('string'))
      .replace(/<Relationship\b[^>]*Type="[^"]*\/(comments|vmlDrawing|pivotTable|table)"[^>]*\/>/g, '')
      .replace(/(<Relationship\b[^>]*?)Target="\/([^"]+)"/g, (_match, start: string, target: string) =>
        `${start}Target="${relativeTarget(folder, target)}"`,
      );
    zip.file(name, xml);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

function argbToRgb(color: Partial<ExcelJSNamespace.Color> | undefined, report: InterchangeReport, isDefault: boolean): string | undefined {
  if (color === undefined) {
    return undefined;
  }
  if (typeof color.argb === 'string' && /^[0-9a-fA-F]{8}$/.test(color.argb)) {
    return `#${color.argb.slice(2).toUpperCase()}`;
  }
  if (typeof color.argb === 'string' && /^[0-9a-fA-F]{6}$/.test(color.argb)) {
    return `#${color.argb.toUpperCase()}`;
  }
  if (color.theme !== undefined && !isDefault) {
    count(report, 'themeColours');
  }
  return undefined;
}

function rgbToArgb(rgb: unknown): Partial<ExcelJSNamespace.Color> | undefined {
  if (typeof rgb !== 'string') {
    return undefined;
  }
  const hex = rgb.replace('#', '');
  return /^[0-9a-fA-F]{6}$/.test(hex) ? { argb: `FF${hex.toUpperCase()}` } : undefined;
}

function isDefaultFont(font: Partial<ExcelJSNamespace.Font>): boolean {
  return font.scheme === 'minor' || font.scheme === 'major';
}

export function styleFromExcel(style: Style, numFmt: string | undefined, report: InterchangeReport): StyleData | undefined {
  const result: Record<string, unknown> = {};
  const font = style.font;
  if (font !== undefined) {
    if (font.bold) result.bl = 1;
    if (font.italic) result.it = 1;
    if (font.underline !== undefined && font.underline !== false && font.underline !== 'none') result.ul = { s: 1 };
    if (font.strike) result.st = { s: 1 };
    const defaultFont = isDefaultFont(font);
    const colour = argbToRgb(font.color, report, defaultFont && font.color?.theme === 1);
    if (colour !== undefined) result.cl = { rgb: colour };
    if (!defaultFont && typeof font.name === 'string') result.ff = font.name;
    if (typeof font.size === 'number' && (font.size !== DEFAULT_FONT_SIZE || !defaultFont)) result.fs = font.size;
  }
  const fill = style.fill;
  if (fill?.type === 'pattern' && fill.pattern !== undefined && fill.pattern !== 'none') {
    const colour = argbToRgb(fill.fgColor, report, false);
    if (colour !== undefined) result.bg = { rgb: colour };
  } else if (fill?.type === 'gradient') {
    count(report, 'gradientFills');
  }
  const border = style.border;
  if (border !== undefined) {
    const sides: Record<string, unknown> = {};
    for (const [excel, univer] of BORDER_SIDES) {
      const side = border[excel];
      const kind = side?.style === undefined ? undefined : BORDER_STYLES[side.style];
      if (kind !== undefined) {
        sides[univer] = { s: kind, cl: { rgb: argbToRgb(side?.color, report, false) ?? '#000000' } };
      }
    }
    if (Object.keys(sides).length > 0) result.bd = sides;
  }
  const alignment = style.alignment;
  if (alignment !== undefined) {
    if (alignment.horizontal !== undefined && HORIZONTAL[alignment.horizontal] !== undefined) result.ht = HORIZONTAL[alignment.horizontal];
    if (alignment.vertical !== undefined && VERTICAL[alignment.vertical] !== undefined) result.vt = VERTICAL[alignment.vertical];
    if (alignment.wrapText) result.tb = WRAP;
    const rotation = alignment.textRotation;
    if (rotation === 'vertical' || rotation === 255) {
      result.tr = { a: 0, v: 1 };
    } else if (typeof rotation === 'number' && rotation !== 0) {
      result.tr = { a: rotation > 90 ? 90 - rotation : rotation };
    }
  }
  if (numFmt !== undefined && numFmt !== '' && numFmt !== 'General' && numFmt !== '@') {
    result.n = { pattern: numFmt };
  }
  return Object.keys(result).length > 0 ? (result as StyleData) : undefined;
}

export function styleToExcel(style: IStyleData | undefined): { style: Style; numFmt?: string } {
  if (style === undefined) {
    return { style: {} };
  }
  const result: Style = {};
  const font: Partial<ExcelJSNamespace.Font> = {};
  if (style.bl) font.bold = true;
  if (style.it) font.italic = true;
  if (style.ul?.s) font.underline = true;
  if (style.st?.s) font.strike = true;
  if (typeof style.ff === 'string') font.name = style.ff;
  if (typeof style.fs === 'number') font.size = style.fs;
  const colour = rgbToArgb(style.cl?.rgb);
  if (colour !== undefined) font.color = colour as ExcelJSNamespace.Color;
  if (Object.keys(font).length > 0) result.font = font;
  const background = rgbToArgb(style.bg?.rgb);
  if (background !== undefined) {
    result.fill = { type: 'pattern', pattern: 'solid', fgColor: background as ExcelJSNamespace.Color };
  }
  if (style.bd) {
    const border: Partial<ExcelJSNamespace.Borders> = {};
    for (const [excel, univer] of BORDER_SIDES) {
      const side = style.bd[univer];
      const name = side?.s === undefined ? undefined : BORDER_NAMES[side.s];
      if (name !== undefined) {
        border[excel] = { style: name as ExcelJSNamespace.BorderStyle, color: rgbToArgb(side?.cl?.rgb) as ExcelJSNamespace.Color };
      }
    }
    if (Object.keys(border).length > 0) result.border = border;
  }
  const alignment: Partial<ExcelJSNamespace.Alignment> = {};
  if (typeof style.ht === 'number' && HORIZONTAL_NAMES[style.ht]) alignment.horizontal = HORIZONTAL_NAMES[style.ht] as ExcelJSNamespace.Alignment['horizontal'];
  if (typeof style.vt === 'number' && VERTICAL_NAMES[style.vt]) alignment.vertical = VERTICAL_NAMES[style.vt] as ExcelJSNamespace.Alignment['vertical'];
  if (style.tb === WRAP) alignment.wrapText = true;
  if (style.tr?.v) {
    alignment.textRotation = 'vertical';
  } else if (typeof style.tr?.a === 'number' && style.tr.a !== 0) {
    alignment.textRotation = style.tr.a < 0 ? 90 - style.tr.a : style.tr.a;
  }
  if (Object.keys(alignment).length > 0) result.alignment = alignment;
  return { style: result, numFmt: style.n?.pattern ?? undefined };
}

export function dateToSerial(date: Date, date1904 = false): number {
  const days = (date.getTime() - EXCEL_EPOCH_MS) / DAY_MS;
  return date1904 ? days - EXCEL_1904_OFFSET_DAYS : days;
}

export function stripFunctionPrefixes(formula: string): string {
  return formula.replace(/_xlfn\._xlws\.|_xlfn\.|_xlws\./g, '');
}

export function addFunctionPrefixes(formula: string): string {
  const names = FUTURE_FUNCTIONS.map((name) => name.replace('.', '\\.')).join('|');
  return formula.replace(new RegExp(`(^|[^A-Za-z0-9_.])(${names})\\(`, 'gi'), (_match, before: string, name: string) => `${before}_xlfn.${name.toUpperCase()}(`);
}

function decodeRange(reference: string): IRange | undefined {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(reference.trim());
  if (match === null) {
    return undefined;
  }
  return {
    startRow: Number(match[2]) - 1,
    startColumn: columnIndex(match[1]),
    endRow: Number(match[4] ?? match[2]) - 1,
    endColumn: columnIndex(match[3] ?? match[1]),
  };
}

function richTextOf(value: unknown): string | undefined {
  const runs = (value as { richText?: { text: string }[] } | null)?.richText;
  return Array.isArray(runs) ? runs.map((run) => run.text).join('') : undefined;
}

function cellFromExcel(cell: Cell, date1904: boolean, report: InterchangeReport): ICellData | undefined {
  const value = cell.value as unknown;
  switch (cell.type) {
    case VALUE.Null:
    case VALUE.Merge:
      return undefined;
    case VALUE.Number:
      return { v: value as number, t: CELL_NUMBER };
    case VALUE.Boolean:
      return { v: value as boolean, t: CELL_BOOLEAN };
    case VALUE.Date:
      return { v: dateToSerial(value as Date, date1904), t: CELL_NUMBER };
    case VALUE.String:
    case VALUE.SharedString:
      return { v: String(value), t: cell.numFmt === '@' ? CELL_FORCE_STRING : CELL_STRING };
    case VALUE.RichText: {
      count(report, 'richText');
      return { v: richTextOf(value) ?? cell.text, t: CELL_STRING };
    }
    case VALUE.Hyperlink: {
      count(report, 'hyperlinks');
      const text = (value as { text?: unknown }).text;
      return { v: richTextOf(text) ?? String(text ?? cell.text), t: CELL_STRING };
    }
    case VALUE.Error:
      return { v: String((value as { error?: string }).error ?? cell.text), t: CELL_STRING };
    case VALUE.Formula: {
      const formula = cell.formula;
      if ((value as { shareType?: string }).shareType === 'array') {
        count(report, 'arrayFormulas');
      }
      if (typeof formula !== 'string' || formula === '') {
        return undefined;
      }
      return { f: `=${stripFunctionPrefixes(formula)}` };
    }
  }
  return undefined;
}

function sheetFromExcel(sheet: Worksheet, date1904: boolean, report: InterchangeReport): Partial<IWorksheetData> {
  const cellData: Record<number, Record<number, ICellData>> = {};
  const rowData: Record<number, Record<string, unknown>> = {};
  const columnData: Record<number, Record<string, unknown>> = {};
  const styles = new Map<string, StyleData>();
  const styleRef = (style: StyleData | undefined): StyleData | undefined => {
    if (style === undefined) {
      return undefined;
    }
    const key = canonicalJson(style);
    if (!styles.has(key)) {
      styles.set(key, style);
    }
    return styles.get(key);
  };

  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const index = rowNumber - 1;
    const properties: Record<string, unknown> = {};
    if (typeof row.height === 'number' && row.height > 0) properties.h = Math.round(row.height / POINTS_PER_PIXEL);
    if (row.hidden) properties.hd = 1;
    if (Object.keys(properties).length > 0) rowData[index] = properties;
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const style = styleRef(styleFromExcel(cell.style ?? {}, cell.numFmt, report));
      const content = cellFromExcel(cell, date1904, report);
      if (content === undefined && style === undefined) {
        return;
      }
      const result: ICellData = { ...(content ?? {}) };
      if (style !== undefined) {
        result.s = style as IStyleData;
      }
      (cellData[index] ??= {})[columnNumber - 1] = result;
    });
  });

  for (let columnNumber = 1; columnNumber <= sheet.columnCount; columnNumber += 1) {
    const column = sheet.getColumn(columnNumber);
    const properties: Record<string, unknown> = {};
    if (typeof column.width === 'number' && column.width > 0) properties.w = Math.round(column.width * PIXELS_PER_CHARACTER + CHARACTER_PADDING_PIXELS);
    if (column.hidden) properties.hd = 1;
    if (Object.keys(properties).length > 0) columnData[columnNumber - 1] = properties;
  }

  const view = sheet.views?.[0] as Partial<ExcelJSNamespace.WorksheetViewFrozen> & { showGridLines?: boolean; rightToLeft?: boolean } | undefined;
  const data: Partial<IWorksheetData> = {
    id: randomId(SHEET_ID_LENGTH),
    name: sheet.name,
    rowCount: Math.max(DEFAULT_ROW_COUNT, sheet.rowCount),
    columnCount: Math.max(DEFAULT_COLUMN_COUNT, sheet.columnCount),
    cellData,
    rowData,
    columnData,
    mergeData: ((sheet.model as { merges?: string[] }).merges ?? [])
      .map(decodeRange)
      .filter((range): range is IRange => range !== undefined),
  };
  if (view?.state === 'frozen' && ((view.xSplit ?? 0) > 0 || (view.ySplit ?? 0) > 0)) {
    data.freeze = { xSplit: view.xSplit ?? 0, ySplit: view.ySplit ?? 0, startRow: view.ySplit ?? 0, startColumn: view.xSplit ?? 0 };
  }
  if (view?.showGridLines === false) data.showGridlines = 0;
  if (view?.rightToLeft) data.rightToLeft = 1;
  if (sheet.state === 'hidden' || sheet.state === 'veryHidden') data.hidden = 1;
  const tab = argbToRgb(sheet.properties.tabColor, report, false);
  if (tab !== undefined) data.tabColor = tab;

  const validations = Object.values((sheet as unknown as { dataValidations?: { model?: Record<string, unknown> } }).dataValidations?.model ?? {});
  count(report, 'dataValidations', new Set(validations.map((rule) => JSON.stringify(rule))).size);
  const formattings = (sheet as unknown as { conditionalFormattings?: { rules?: unknown[] }[] }).conditionalFormattings ?? [];
  count(report, 'conditionalFormats', formattings.reduce((total, entry) => total + (entry.rules?.length ?? 0), 0));
  count(report, 'images', sheet.getImages().length);
  return data;
}

export async function readXlsx(
  bytes: Uint8Array,
  identity: { unitId: string; name: string; locale: LocaleType; appVersion: string },
): Promise<ImportedWorkbook> {
  const report: InterchangeReport = {};
  const ExcelJS = await loadExcelJS();
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await normalisePackage(bytes, report)) as unknown as ArrayBuffer);
  const date1904 = Boolean(book.properties.date1904);

  const sheets: IWorkbookData['sheets'] = {};
  const sheetOrder: string[] = [];
  const styles: Record<string, IStyleData> = {};
  for (const sheet of book.worksheets) {
    const data = sheetFromExcel(sheet, date1904, report);
    for (const row of Object.values(data.cellData ?? {}) as Record<number, ICellData>[]) {
      for (const cell of Object.values(row)) {
        if (cell.s !== undefined && cell.s !== null && typeof cell.s === 'object') {
          const id = styleId(cell.s as StyleData);
          styles[id] = cell.s as IStyleData;
          cell.s = id;
        }
      }
    }
    sheets[data.id as string] = data;
    sheetOrder.push(data.id as string);
  }

  const names = ((book.definedNames as unknown as { model: { name: string; ranges: string[] }[] }).model ?? [])
    .filter((entry) => entry.ranges.length > 0 && !entry.name.startsWith('_xlnm.'))
    .map((entry) => ({ name: entry.name, formula: entry.ranges.join(',') }));

  return {
    workbook: { id: identity.unitId, name: identity.name, appVersion: identity.appVersion, locale: identity.locale, styles, sheetOrder, sheets },
    names,
    report,
  };
}

function exportedCell(cell: ICellData): ExcelJSNamespace.CellValue {
  const body = (cell.p as { body?: { dataStream?: string } } | null | undefined)?.body?.dataStream;
  if (typeof cell.f === 'string' && cell.f.length > 0) {
    const formula = addFunctionPrefixes(cell.f.replace(/^=/, ''));
    const result = cell.v === null || cell.v === undefined ? undefined : cell.v;
    return result === undefined ? { formula } : ({ formula, result } as ExcelJSNamespace.CellFormulaValue);
  }
  if (cell.v === null || cell.v === undefined) {
    return typeof body === 'string' ? body.replace(/\r?\n$/, '').replace(/\r\n?/g, '\n') : null;
  }
  if (cell.t === CELL_NUMBER && typeof cell.v === 'string' && cell.v.trim() !== '' && Number.isFinite(Number(cell.v))) {
    return Number(cell.v);
  }
  return cell.v;
}

export async function writeXlsx(workbook: IWorkbookData, names: readonly ExportedName[] = []): Promise<Uint8Array> {
  const ExcelJS = await loadExcelJS();
  const book = new ExcelJS.Workbook();
  book.creator = 'Zekke';
  const resolveStyle = (style: unknown): IStyleData | undefined =>
    typeof style === 'string' ? (workbook.styles[style] ?? undefined) : typeof style === 'object' && style !== null ? (style as IStyleData) : undefined;

  for (const sheetId of workbook.sheetOrder) {
    const data = workbook.sheets[sheetId];
    if (data === undefined) {
      continue;
    }
    const freeze = data.freeze !== undefined && (data.freeze.xSplit > 0 || data.freeze.ySplit > 0) ? data.freeze : undefined;
    const sheet = book.addWorksheet(data.name ?? 'Sheet', {
      state: data.hidden ? 'hidden' : 'visible',
      properties: data.tabColor ? { tabColor: rgbToArgb(data.tabColor) as ExcelJSNamespace.Color } : {},
      views: [
        {
          state: freeze === undefined ? 'normal' : 'frozen',
          xSplit: freeze?.xSplit,
          ySplit: freeze?.ySplit,
          showGridLines: data.showGridlines !== 0,
          rightToLeft: data.rightToLeft === 1,
        } as ExcelJSNamespace.WorksheetView,
      ],
    });

    for (const [rowKey, row] of Object.entries(data.cellData ?? {}) as [string, Record<string, ICellData | null>][]) {
      for (const [columnKey, cell] of Object.entries(row ?? {})) {
        if (cell === null || cell === undefined) {
          continue;
        }
        const target = sheet.getCell(Number(rowKey) + 1, Number(columnKey) + 1);
        target.value = exportedCell(cell);
        const { style, numFmt } = styleToExcel(resolveStyle(cell.s));
        if (Object.keys(style).length > 0) target.style = { ...style };
        if (cell.t === CELL_FORCE_STRING) {
          target.numFmt = '@';
        } else if (numFmt !== undefined) {
          target.numFmt = numFmt;
        }
      }
    }
    for (const [rowKey, row] of Object.entries(data.rowData ?? {})) {
      const target = sheet.getRow(Number(rowKey) + 1);
      if (typeof row?.h === 'number') target.height = Math.round(row.h * POINTS_PER_PIXEL * 100) / 100;
      if (row?.hd === 1) target.hidden = true;
    }
    for (const [columnKey, column] of Object.entries(data.columnData ?? {})) {
      const target = sheet.getColumn(Number(columnKey) + 1);
      if (typeof column?.w === 'number') target.width = Math.round(((column.w - CHARACTER_PADDING_PIXELS) / PIXELS_PER_CHARACTER) * 100) / 100;
      if (column?.hd === 1) target.hidden = true;
    }
    for (const merge of data.mergeData ?? []) {
      sheet.mergeCells(
        `${columnLetters(merge.startColumn)}${merge.startRow + 1}:${columnLetters(merge.endColumn)}${merge.endRow + 1}`,
      );
    }
  }
  for (const name of names) {
    book.definedNames.add(name.formula.replace(/^=/, ''), name.name);
  }
  return new Uint8Array(await book.xlsx.writeBuffer());
}
