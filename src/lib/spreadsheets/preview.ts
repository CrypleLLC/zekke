import * as Y from 'yjs';
import { readAxis } from './axis';
import { readContent, type CellContent } from './cells';
import { FORMULA_CODEC } from './formulas';
import type { SpreadsheetRegional } from '@/lib/regional';
import { markSpreadsheet } from './layout';
import { writeSheetRegional } from './sheet-regional';
import { createSheet, readSheets } from './sheets';
import { WorkbookIndex } from './workbook';

export const PREVIEW_ROWS = 12;
export const PREVIEW_COLUMNS = 6;
export const PREVIEW_CELL_CHARACTERS = 24;
export const FIRST_SHEET_NAME = 'Sheet1';

function richText(content: { p: Record<string, unknown> }): string {
  const body = content.p.body as { dataStream?: unknown } | undefined;
  return typeof body?.dataStream === 'string' ? body.dataStream.replace(/[\r\n]+/g, ' ').trim() : '';
}

export function cellPreviewText(content: CellContent | undefined, display: (stored: string) => string): string {
  if (content === undefined) {
    return '';
  }
  if (typeof content === 'number') {
    return String(content);
  }
  if (typeof content === 'boolean') {
    return content ? 'TRUE' : 'FALSE';
  }
  if (typeof content === 'string') {
    return content;
  }
  if ('f' in content) {
    return display(content.f);
  }
  if ('p' in content) {
    return richText(content);
  }
  return String(content.v);
}

function clip(text: string): string {
  return text.length > PREVIEW_CELL_CHARACTERS ? `${text.slice(0, PREVIEW_CELL_CHARACTERS - 1)}…` : text;
}

export function readSheetPreview(doc: Y.Doc, rows = PREVIEW_ROWS, columns = PREVIEW_COLUMNS): string[][] {
  const first = readSheets(doc)[0];
  if (first === undefined) {
    return [];
  }
  const rowIds = readAxis(first.sheet, 'rows').ids.slice(0, rows);
  const columnIds = readAxis(first.sheet, 'columns').ids.slice(0, columns);
  const workbook = new WorkbookIndex(doc);
  const grid = rowIds.map((rowId, row) =>
    columnIds.map((columnId, column) =>
      clip(
        cellPreviewText(readContent(first.sheet, rowId, columnId), (stored) =>
          FORMULA_CODEC.display(stored, { sheetId: first.id, row, column, workbook }),
        ),
      ),
    ),
  );
  let last = grid.length - 1;
  while (last >= 0 && grid[last].every((cell) => cell === '')) {
    last -= 1;
  }
  return grid.slice(0, last + 1);
}

export function newSpreadsheetDoc(regional?: SpreadsheetRegional): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    markSpreadsheet(doc);
    createSheet(doc, { name: FIRST_SHEET_NAME });
    if (regional !== undefined) {
      writeSheetRegional(doc, regional);
    }
  });
  return doc;
}

export function newSpreadsheetSnapshot(regional?: SpreadsheetRegional): Uint8Array {
  const doc = newSpreadsheetDoc(regional);
  try {
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}
