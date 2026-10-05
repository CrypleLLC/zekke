import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  FIRST_SHEET_NAME,
  FORMULA_CODEC,
  PREVIEW_CELL_CHARACTERS,
  insertLines,
  isSpreadsheet,
  newSpreadsheetDoc,
  newSpreadsheetSnapshot,
  readAxis,
  readSheetName,
  readSheetPreview,
  readSheets,
  storeFormula,
  WorkbookIndex,
  writeContent,
  type SheetMap,
} from './index';

function put(doc: Y.Doc, sheet: SheetMap, row: number, column: number, value: Parameters<typeof writeContent>[3]) {
  writeContent(sheet, readAxis(sheet, 'rows').idAt(row)!, readAxis(sheet, 'columns').idAt(column)!, value);
  void doc;
}

describe('a new spreadsheet', () => {
  it('is a spreadsheet with one empty sheet of the default size', () => {
    const doc = newSpreadsheetDoc();
    expect(isSpreadsheet(doc)).toBe(true);
    const sheets = readSheets(doc);
    expect(sheets).toHaveLength(1);
    expect(readSheetName(sheets[0].sheet)).toBe(FIRST_SHEET_NAME);
    expect(readAxis(sheets[0].sheet, 'rows').size).toBe(1000);
    expect(readAxis(sheets[0].sheet, 'columns').size).toBe(26);
  });

  it('round-trips through its snapshot', () => {
    const copy = new Y.Doc();
    Y.applyUpdate(copy, newSpreadsheetSnapshot());
    expect(isSpreadsheet(copy)).toBe(true);
    expect(readSheets(copy)).toHaveLength(1);
  });
});

describe('the list preview', () => {
  it('shows the first sheet’s top-left cells as text, trimmed of empty trailing rows', () => {
    const doc = newSpreadsheetDoc();
    const { id, sheet } = readSheets(doc)[0];
    put(doc, sheet, 0, 0, 'Month');
    put(doc, sheet, 0, 1, 1200.5);
    put(doc, sheet, 1, 2, true);
    put(doc, sheet, 2, 0, { f: storeFormula('=SUM(B1:B2)', { sheetId: id, row: 2, column: 0, workbook: new WorkbookIndex(doc) }) });
    put(doc, sheet, 3, 1, { p: { body: { dataStream: 'rich\r\ntext\r\n' } } });
    put(doc, sheet, 4, 1, 'x'.repeat(100));
    put(doc, sheet, 50, 0, 'far below');

    const grid = readSheetPreview(doc, 6, 3);
    expect(grid).toHaveLength(5);
    expect(grid[0]).toEqual(['Month', '1200.5', '']);
    expect(grid[1][2]).toBe('TRUE');
    expect(grid[2][0]).toBe('=SUM(B1:B2)');
    expect(grid[3][1]).toBe('rich text');
    expect(grid[4][1]).toHaveLength(PREVIEW_CELL_CHARACTERS);
  });

  it('shows formulas at their current positions', () => {
    const doc = newSpreadsheetDoc();
    const { id, sheet } = readSheets(doc)[0];
    put(doc, sheet, 0, 0, { f: FORMULA_CODEC.store('=B5', { sheetId: id, row: 0, column: 0, workbook: new WorkbookIndex(doc) }) });
    insertLines(sheet, 'rows', 1, 2);
    expect(readSheetPreview(doc)[0][0]).toBe('=B7');
  });

  it('is empty for an empty sheet', () => {
    expect(readSheetPreview(newSpreadsheetDoc())).toEqual([]);
  });
});
