import * as Y from 'yjs';
import { appendLines, insertLineIds } from './axis';
import { SHEET_ID_LENGTH, freshIds } from './ids';
import {
  SHEET_NAME,
  newSheetMap,
  sheetOrderArray,
  sheetsMap,
  type SheetMap,
} from './layout';

export const DEFAULT_ROW_COUNT = 1000;
export const DEFAULT_COLUMN_COUNT = 26;

export interface SheetEntry {
  id: string;
  sheet: SheetMap;
}

export function readSheets(doc: Y.Doc): SheetEntry[] {
  const sheets = sheetsMap(doc);
  const seen = new Set<string>();
  const entries: SheetEntry[] = [];
  for (const id of sheetOrderArray(doc).toArray()) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const sheet = sheets.get(id);
    if (sheet instanceof Y.Map) {
      entries.push({ id, sheet });
    }
  }
  return entries;
}

export function readSheet(doc: Y.Doc, id: string): SheetMap | undefined {
  const sheet = sheetsMap(doc).get(id);
  return sheet instanceof Y.Map ? sheet : undefined;
}

export function readSheetName(sheet: SheetMap): string {
  const name = sheet.get(SHEET_NAME);
  return typeof name === 'string' ? name : '';
}

export function createSheet(
  doc: Y.Doc,
  options: {
    id?: string;
    name: string;
    index?: number;
    rows?: number;
    columns?: number;
    rowIds?: readonly string[];
    columnIds?: readonly string[];
  },
  origin?: unknown,
): string {
  const order = sheetOrderArray(doc);
  const id = options.id ?? freshIds(1, SHEET_ID_LENGTH, new Set(sheetsMap(doc).keys()))[0];
  const live = readSheets(doc);
  const index = Math.min(Math.max(0, options.index ?? live.length), live.length);

  doc.transact(() => {
    const sheet = newSheetMap(options.name);
    sheetsMap(doc).set(id, sheet);
    order.insert(sequencePositionOfSheet(order.toArray(), live, index), [id]);
    if (options.rowIds === undefined) {
      appendLines(sheet, 'rows', options.rows ?? DEFAULT_ROW_COUNT);
    } else {
      insertLineIds(sheet, 'rows', options.rowIds);
    }
    if (options.columnIds === undefined) {
      appendLines(sheet, 'columns', options.columns ?? DEFAULT_COLUMN_COUNT);
    } else {
      insertLineIds(sheet, 'columns', options.columnIds);
    }
  }, origin);

  return id;
}

function sequencePositionOfSheet(sequence: readonly string[], live: readonly SheetEntry[], index: number): number {
  if (index >= live.length) {
    return sequence.length;
  }
  return sequence.indexOf(live[index].id);
}

export function removeSheet(doc: Y.Doc, id: string, origin?: unknown): void {
  doc.transact(() => {
    const order = sheetOrderArray(doc);
    const sequence = order.toArray();
    for (let position = sequence.length - 1; position >= 0; position -= 1) {
      if (sequence[position] === id) {
        order.delete(position, 1);
      }
    }
    sheetsMap(doc).delete(id);
  }, origin);
}

export function moveSheet(doc: Y.Doc, id: string, toIndex: number, origin?: unknown): void {
  const live = readSheets(doc);
  const from = live.findIndex((entry) => entry.id === id);
  if (from === -1 || from === toIndex) {
    return;
  }
  doc.transact(() => {
    const order = sheetOrderArray(doc);
    const sequence = order.toArray();
    for (let position = sequence.length - 1; position >= 0; position -= 1) {
      if (sequence[position] === id) {
        order.delete(position, 1);
      }
    }
    const remaining = live.filter((entry) => entry.id !== id);
    order.insert(sequencePositionOfSheet(order.toArray(), remaining, toIndex), [id]);
  }, origin);
}

export function writeSheetProperty(sheet: SheetMap, key: string, value: unknown, origin?: unknown): void {
  const change = () => {
    if (value === undefined) {
      sheet.delete(key);
    } else if (JSON.stringify(sheet.get(key)) !== JSON.stringify(value)) {
      sheet.set(key, value);
    }
  };
  if (sheet.doc === null) {
    change();
  } else {
    sheet.doc.transact(change, origin);
  }
}
