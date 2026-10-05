import { line } from './axis';
import { LINE_PROPERTY_PREFIX, LINE_STYLE, STYLE_KEY_PREFIX, styleKey, type SheetMap } from './layout';

export const CELL_STRING = 1;
export const CELL_NUMBER = 2;
export const CELL_BOOLEAN = 3;
export const CELL_FORCE_STRING = 4;

export interface FormulaContent {
  f: string;
}

export interface RichTextContent {
  p: Record<string, unknown>;
}

export interface TypedContent {
  v: string | number | boolean;
  t: number;
}

export type CellContent = number | boolean | string | FormulaContent | RichTextContent | TypedContent;

export interface CellData {
  v?: string | number | boolean | null;
  t?: number | null;
  f?: string | null;
  si?: string | null;
  p?: unknown;
  s?: unknown;
}

export class SharedFormulaError extends Error {
  constructor() {
    super('A cell carries a shared formula id without its formula; expand shared formulas before storing.');
    this.name = 'SharedFormulaError';
  }
}

export function encodeContent(cell: CellData, storeFormula: (formula: string) => string): CellContent | undefined {
  if (typeof cell.f === 'string' && cell.f.length > 0) {
    return { f: storeFormula(cell.f) };
  }
  if (typeof cell.si === 'string' && cell.si.length > 0) {
    throw new SharedFormulaError();
  }
  if (typeof cell.p === 'object' && cell.p !== null) {
    return { p: cell.p as Record<string, unknown> };
  }

  const value = cell.v;
  if (value === undefined || value === null) {
    return undefined;
  }
  const type = cell.t ?? undefined;

  if (typeof value === 'number') {
    return type === undefined || type === CELL_NUMBER ? value : { v: value, t: type };
  }
  if (typeof value === 'boolean') {
    return type === undefined || type === CELL_BOOLEAN ? value : { v: value, t: type };
  }
  if (type === undefined || type === CELL_STRING) {
    return value;
  }
  if (type === CELL_NUMBER && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return { v: value, t: type };
}

export function decodeContent(
  content: CellContent,
  displayFormula: (stored: string) => string,
): CellData {
  if (typeof content === 'number') {
    return { v: content, t: CELL_NUMBER };
  }
  if (typeof content === 'boolean') {
    return { v: content, t: CELL_BOOLEAN };
  }
  if (typeof content === 'string') {
    return { v: content, t: CELL_STRING };
  }
  if ('f' in content) {
    return { f: displayFormula(content.f) };
  }
  if ('p' in content) {
    return { p: content.p };
  }
  return { v: content.v, t: content.t };
}

export function isCellContent(value: unknown): value is CellContent {
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return true;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.f === 'string') {
    return true;
  }
  if (typeof record.p === 'object' && record.p !== null) {
    return true;
  }
  return (
    typeof record.t === 'number' &&
    (typeof record.v === 'string' || typeof record.v === 'number' || typeof record.v === 'boolean')
  );
}

export function readContent(sheet: SheetMap, rowId: string, columnId: string): CellContent | undefined {
  const stored = line(sheet, 'rows', rowId)?.get(columnId);
  return isCellContent(stored) ? stored : undefined;
}

export function readCellStyleId(sheet: SheetMap, rowId: string, columnId: string): string | undefined {
  const stored = line(sheet, 'rows', rowId)?.get(styleKey(columnId));
  return typeof stored === 'string' ? stored : undefined;
}

export function writeContent(sheet: SheetMap, rowId: string, columnId: string, content: CellContent | undefined): void {
  const row = line(sheet, 'rows', rowId);
  if (row === undefined) {
    return;
  }
  if (content === undefined) {
    if (row.has(columnId)) {
      row.delete(columnId);
    }
    return;
  }
  if (!sameContent(row.get(columnId), content)) {
    row.set(columnId, content);
  }
}

export function writeCellStyleId(sheet: SheetMap, rowId: string, columnId: string, id: string | undefined): void {
  const row = line(sheet, 'rows', rowId);
  if (row === undefined) {
    return;
  }
  const key = styleKey(columnId);
  if (id === undefined) {
    if (row.has(key)) {
      row.delete(key);
    }
    return;
  }
  if (row.get(key) !== id) {
    row.set(key, id);
  }
}

function sameContent(stored: unknown, content: CellContent): boolean {
  if (typeof content !== 'object') {
    return stored === content;
  }
  return typeof stored === 'object' && stored !== null && JSON.stringify(stored) === JSON.stringify(content);
}

export function forEachCell(
  sheet: SheetMap,
  rowId: string,
  visit: (columnId: string, content: CellContent | undefined, styleId: string | undefined) => void,
): void {
  const row = line(sheet, 'rows', rowId);
  if (row === undefined) {
    return;
  }
  const columns = new Set<string>();
  for (const key of row.keys()) {
    if (key.startsWith(LINE_PROPERTY_PREFIX) || key === LINE_STYLE) {
      continue;
    }
    columns.add(key.startsWith(STYLE_KEY_PREFIX) ? key.slice(STYLE_KEY_PREFIX.length) : key);
  }
  for (const columnId of columns) {
    const content = row.get(columnId);
    const style = row.get(styleKey(columnId));
    visit(columnId, isCellContent(content) ? content : undefined, typeof style === 'string' ? style : undefined);
  }
}
