import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { IWorkbookData, LocaleType } from '@univerjs/core';
import {
  Axis,
  COLUMN_ID_LENGTH,
  ROW_ID_LENGTH,
  SharedFormulaError,
  addMerge,
  anchorRange,
  createSheet,
  decodeContent,
  encodeContent,
  fromWorkbookData,
  insertLines,
  internStyle,
  isId,
  isSpreadsheet,
  markSpreadsheet,
  moveLines,
  moveSheet,
  readAxis,
  readCellStyleId,
  readContent,
  readMerges,
  readRules,
  readSheet,
  readSheets,
  readSheetName,
  removeLines,
  removeSheet,
  resolveRange,
  restoreLines,
  styleId,
  toWorkbookData,
  writeCellStyleId,
  writeContent,
  writeRule,
  type FormulaCodec,
  type FormulaScope,
  type SheetMap,
} from './index';

const IDENTITY: FormulaCodec = {
  store: (formula) => formula,
  display: (stored) => stored,
};

function newWorkbook(rows = 10, columns = 5): { doc: Y.Doc; sheetId: string; sheet: SheetMap } {
  const doc = new Y.Doc();
  markSpreadsheet(doc);
  const sheetId = createSheet(doc, { name: 'Sheet1', rows, columns });
  return { doc, sheetId, sheet: readSheet(doc, sheetId) as SheetMap };
}

function replicate(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
}

function sync(...docs: Y.Doc[]): void {
  const updates = docs.map((doc) => Y.encodeStateAsUpdate(doc));
  for (const doc of docs) {
    for (const update of updates) {
      Y.applyUpdate(doc, update);
    }
  }
}

function sheetOf(doc: Y.Doc, id: string): SheetMap {
  return readSheet(doc, id) as SheetMap;
}

function setValue(sheet: SheetMap, row: number, column: number, value: number | string): void {
  const rowId = readAxis(sheet, 'rows').idAt(row) as string;
  const columnId = readAxis(sheet, 'columns').idAt(column) as string;
  writeContent(sheet, rowId, columnId, value);
}

function valueAt(sheet: SheetMap, row: number, column: number): unknown {
  const rowId = readAxis(sheet, 'rows').idAt(row) as string;
  const columnId = readAxis(sheet, 'columns').idAt(column) as string;
  return readContent(sheet, rowId, columnId);
}

describe('the spreadsheet kind', () => {
  it('is absent on a document and present once marked', () => {
    const doc = new Y.Doc();
    expect(isSpreadsheet(doc)).toBe(false);
    markSpreadsheet(doc);
    expect(isSpreadsheet(doc)).toBe(true);
  });
});

describe('row and column ids', () => {
  it('are random, of the dimension length, and unique within the sheet', () => {
    const { sheet } = newWorkbook(500, 40);
    const rows = readAxis(sheet, 'rows');
    const columns = readAxis(sheet, 'columns');
    expect(rows.size).toBe(500);
    expect(columns.size).toBe(40);
    expect(rows.ids.every((id) => isId(id, ROW_ID_LENGTH))).toBe(true);
    expect(columns.ids.every((id) => isId(id, COLUMN_ID_LENGTH))).toBe(true);
    expect(new Set(rows.ids).size).toBe(500);
  });

  it('give every new row its line up front, so two devices never create the same row map', () => {
    const { sheet } = newWorkbook(3, 2);
    const [id] = insertLines(sheet, 'rows', 1, 1);
    expect(sheet.get('rows')).toBeInstanceOf(Y.Map);
    expect((sheet.get('rows') as Y.Map<unknown>).get(id)).toBeInstanceOf(Y.Map);
  });
});

describe('the axis', () => {
  it('inserts before the line that held the index, and appends past the end', () => {
    const { sheet } = newWorkbook(3, 1);
    const before = readAxis(sheet, 'rows').ids;
    const [inserted] = insertLines(sheet, 'rows', 1, 1);
    const [appended] = insertLines(sheet, 'rows', 99, 1);
    expect(readAxis(sheet, 'rows').ids).toEqual([before[0], inserted, before[1], before[2], appended]);
  });

  it('keeps a removed id in the sequence, out of the live order, and restores it in place', () => {
    const { sheet } = newWorkbook(4, 1);
    const ids = readAxis(sheet, 'rows').ids;
    expect(removeLines(sheet, 'rows', 1, 2)).toEqual([ids[1], ids[2]]);
    const axis = readAxis(sheet, 'rows');
    expect(axis.ids).toEqual([ids[0], ids[3]]);
    expect(axis.knows(ids[1])).toBe(true);
    restoreLines(sheet, 'rows', [ids[1], ids[2]]);
    expect(readAxis(sheet, 'rows').ids).toEqual(ids);
  });

  it('moves a block forward and backward in pre-move coordinates', () => {
    const { sheet } = newWorkbook(5, 1);
    const [a, b, c, d, e] = readAxis(sheet, 'rows').ids;
    moveLines(sheet, 'rows', 0, 2, 4);
    expect(readAxis(sheet, 'rows').ids).toEqual([c, d, a, b, e]);
    moveLines(sheet, 'rows', 3, 2, 0);
    expect(readAxis(sheet, 'rows').ids).toEqual([b, e, c, d, a]);
  });

  it('treats a move onto itself as nothing', () => {
    const { sheet } = newWorkbook(4, 1);
    const ids = readAxis(sheet, 'rows').ids;
    expect(moveLines(sheet, 'rows', 1, 2, 2)).toEqual([]);
    expect(readAxis(sheet, 'rows').ids).toEqual(ids);
  });

  it('keeps the first occurrence when the same id appears twice', () => {
    const axis = new Axis(['a', 'b', 'a', 'c'], new Set());
    expect(axis.ids).toEqual(['a', 'b', 'c']);
    expect(axis.indexOf('c')).toBe(2);
  });

  it('resolves a removed endpoint inward: a start to the next live line, an end to the previous one', () => {
    const axis = new Axis(['a', 'b', 'c', 'd'], new Set(['b']));
    expect(axis.startIndexOf('b')).toBe(1);
    expect(axis.endIndexOf('b')).toBe(0);
    expect(new Axis(['a', 'b'], new Set(['a'])).endIndexOf('a')).toBeUndefined();
    expect(new Axis(['a', 'b'], new Set(['b'])).startIndexOf('b')).toBeUndefined();
  });
});

describe('concurrent structure', () => {
  it('keeps both rows when two devices insert at the same index, in the same order on both', () => {
    const { doc, sheetId } = newWorkbook(3, 1);
    const other = replicate(doc);
    const [mine] = insertLines(sheetOf(doc, sheetId), 'rows', 1, 1);
    const [theirs] = insertLines(sheetOf(other, sheetId), 'rows', 1, 1);
    sync(doc, other);
    const order = readAxis(sheetOf(doc, sheetId), 'rows').ids;
    expect(order).toEqual(readAxis(sheetOf(other, sheetId), 'rows').ids);
    expect(order).toHaveLength(5);
    expect(order.slice(1, 3).sort()).toEqual([mine, theirs].sort());
  });

  it('keeps a value typed into a row another device inserted above', () => {
    const { doc, sheetId } = newWorkbook(3, 2);
    const other = replicate(doc);
    setValue(sheetOf(doc, sheetId), 2, 1, 'typed');
    insertLines(sheetOf(other, sheetId), 'rows', 0, 1);
    sync(doc, other);
    expect(valueAt(sheetOf(other, sheetId), 3, 1)).toBe('typed');
    expect(valueAt(sheetOf(doc, sheetId), 3, 1)).toBe('typed');
  });

  it('drops a value typed into a row another device removed, and nothing else', () => {
    const { doc, sheetId } = newWorkbook(3, 2);
    setValue(sheetOf(doc, sheetId), 0, 0, 'kept');
    const other = replicate(doc);
    setValue(sheetOf(doc, sheetId), 1, 0, 'lost');
    removeLines(sheetOf(other, sheetId), 'rows', 1, 1);
    sync(doc, other);
    for (const replica of [doc, other]) {
      const sheet = sheetOf(replica, sheetId);
      expect(readAxis(sheet, 'rows').size).toBe(2);
      expect(valueAt(sheet, 0, 0)).toBe('kept');
      expect(valueAt(sheet, 1, 0)).toBeUndefined();
    }
  });

  it('clears a removed column from every row', () => {
    const { sheet } = newWorkbook(2, 3);
    setValue(sheet, 0, 1, 'a');
    setValue(sheet, 1, 1, 'b');
    const [columnId] = removeLines(sheet, 'columns', 1, 1);
    const rows = sheet.get('rows') as Y.Map<Y.Map<unknown>>;
    rows.forEach((row) => expect(row.has(columnId)).toBe(false));
  });

  it('keeps a row once when two devices move it at the same time', () => {
    const { doc, sheetId } = newWorkbook(4, 1);
    const other = replicate(doc);
    const [a] = readAxis(sheetOf(doc, sheetId), 'rows').ids;
    moveLines(sheetOf(doc, sheetId), 'rows', 0, 1, 3);
    moveLines(sheetOf(other, sheetId), 'rows', 0, 1, 2);
    sync(doc, other);
    const order = readAxis(sheetOf(doc, sheetId), 'rows').ids;
    expect(order).toEqual(readAxis(sheetOf(other, sheetId), 'rows').ids);
    expect(order).toHaveLength(4);
    expect(order.filter((id) => id === a)).toHaveLength(1);
  });

  it('keeps both a value and a style written to the same cell by two devices', () => {
    const { doc, sheetId } = newWorkbook(2, 2);
    const other = replicate(doc);
    setValue(sheetOf(doc, sheetId), 0, 0, 42);
    const otherSheet = sheetOf(other, sheetId);
    const rowId = readAxis(otherSheet, 'rows').idAt(0) as string;
    const columnId = readAxis(otherSheet, 'columns').idAt(0) as string;
    writeCellStyleId(otherSheet, rowId, columnId, internStyle(other, { bl: 1 }));
    sync(doc, other);
    const sheet = sheetOf(doc, sheetId);
    expect(readContent(sheet, rowId, columnId)).toBe(42);
    expect(readCellStyleId(sheet, rowId, columnId)).toBe(styleId({ bl: 1 }));
  });

  it('keeps both values when two devices type into different cells of the same row', () => {
    const { doc, sheetId } = newWorkbook(2, 2);
    const other = replicate(doc);
    setValue(sheetOf(doc, sheetId), 0, 0, 'left');
    setValue(sheetOf(other, sheetId), 0, 1, 'right');
    sync(doc, other);
    expect(valueAt(sheetOf(doc, sheetId), 0, 0)).toBe('left');
    expect(valueAt(sheetOf(doc, sheetId), 0, 1)).toBe('right');
  });
});

describe('id-anchored ranges', () => {
  function axes(sheet: SheetMap) {
    return { rows: readAxis(sheet, 'rows'), columns: readAxis(sheet, 'columns') };
  }

  it('round-trips a range and grows with a line inserted inside it', () => {
    const { sheet } = newWorkbook(10, 5);
    const { rows, columns } = axes(sheet);
    const anchored = anchorRange({ startRow: 1, endRow: 3, startColumn: 0, endColumn: 1 }, rows, columns)!;
    insertLines(sheet, 'rows', 2, 1);
    const after = axes(sheet);
    expect(resolveRange(anchored, after.rows, after.columns)).toMatchObject({ startRow: 1, endRow: 4 });
  });

  it('shifts with a line inserted above and ignores one inserted just below', () => {
    const { sheet } = newWorkbook(10, 5);
    const { rows, columns } = axes(sheet);
    const anchored = anchorRange({ startRow: 1, endRow: 3, startColumn: 0, endColumn: 0 }, rows, columns)!;
    insertLines(sheet, 'rows', 0, 1);
    insertLines(sheet, 'rows', 5, 1);
    const after = axes(sheet);
    expect(resolveRange(anchored, after.rows, after.columns)).toMatchObject({ startRow: 2, endRow: 4 });
  });

  it('shrinks when an endpoint is removed, and vanishes when every line in it is', () => {
    const { sheet } = newWorkbook(10, 5);
    const { rows, columns } = axes(sheet);
    const anchored = anchorRange({ startRow: 1, endRow: 3, startColumn: 0, endColumn: 0 }, rows, columns)!;
    removeLines(sheet, 'rows', 3, 1);
    let after = axes(sheet);
    expect(resolveRange(anchored, after.rows, after.columns)).toMatchObject({ startRow: 1, endRow: 2 });
    removeLines(sheet, 'rows', 1, 1);
    after = axes(sheet);
    expect(resolveRange(anchored, after.rows, after.columns)).toMatchObject({ startRow: 1, endRow: 1 });
    removeLines(sheet, 'rows', 1, 1);
    after = axes(sheet);
    expect(resolveRange(anchored, after.rows, after.columns)).toBeUndefined();
  });

  it('shrinks the same way when the removal comes from another device', () => {
    const { doc, sheetId } = newWorkbook(10, 2);
    const other = replicate(doc);
    const mine = axes(sheetOf(doc, sheetId));
    const anchored = anchorRange({ startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 }, mine.rows, mine.columns)!;
    removeLines(sheetOf(other, sheetId), 'rows', 2, 1);
    sync(doc, other);
    const after = axes(sheetOf(doc, sheetId));
    expect(resolveRange(anchored, after.rows, after.columns)).toMatchObject({ startRow: 0, endRow: 1 });
  });

  it('leaves the other dimension unbounded for whole rows and whole columns', () => {
    const { sheet } = newWorkbook(10, 5);
    const { rows, columns } = axes(sheet);
    const wholeColumn = anchorRange({ startRow: 0, endRow: 0, startColumn: 2, endColumn: 2, rangeType: 2 }, rows, columns)!;
    expect(wholeColumn.startRow).toBeUndefined();
    insertLines(sheet, 'rows', 0, 3);
    const after = axes(sheet);
    expect(resolveRange(wholeColumn, after.rows, after.columns)).toMatchObject({
      startRow: 0,
      endRow: 12,
      wholeColumns: true,
      wholeRows: false,
    });
  });
});

describe('styles', () => {
  it('are content-addressed, so key order does not matter and two devices agree on the id', () => {
    expect(styleId({ bl: 1, fs: 12 })).toBe(styleId({ fs: 12, bl: 1 }));
    expect(styleId({ bl: 1 })).not.toBe(styleId({ bl: 0 }));
    const a = new Y.Doc();
    const b = new Y.Doc();
    expect(internStyle(a, { it: 1, cl: { rgb: '#f00' } })).toBe(internStyle(b, { cl: { rgb: '#f00' }, it: 1 }));
  });

  it('store nothing for an empty style', () => {
    const doc = new Y.Doc();
    expect(internStyle(doc, {})).toBeUndefined();
    expect(internStyle(doc, { bl: undefined })).toBeUndefined();
  });
});

describe('cell content', () => {
  const store = (formula: string) => `stored:${formula}`;
  const display = (formula: string) => formula.replace('stored:', '');

  it.each([
    [{ v: 3, t: 2 }, 3],
    [{ v: 3 }, 3],
    [{ v: true, t: 3 }, true],
    [{ v: 'text', t: 1 }, 'text'],
    [{ v: '007', t: 4 }, { v: '007', t: 4 }],
    [{ v: '12', t: 2 }, 12],
    [{ f: '=A1', v: 9, t: 2 }, { f: 'stored:=A1' }],
    [{ p: { body: { dataStream: 'x\r\n' } }, v: 'x' }, { p: { body: { dataStream: 'x\r\n' } } }],
    [{ v: null }, undefined],
    [{}, undefined],
  ])('encodes %j as %j', (cell, expected) => {
    expect(encodeContent(cell, store)).toEqual(expected);
  });

  it('never stores a computed formula value, and decodes the formula for display', () => {
    const content = encodeContent({ f: '=SUM(A1:A3)', v: 6, t: 2 }, store)!;
    expect(decodeContent(content, display)).toEqual({ f: '=SUM(A1:A3)' });
  });

  it('refuses a shared formula id without its formula', () => {
    expect(() => encodeContent({ si: 'abc', v: 3 }, store)).toThrow(SharedFormulaError);
  });

  it('writes nothing when the content is unchanged', () => {
    const { doc, sheet } = newWorkbook(1, 1);
    setValue(sheet, 0, 0, 'same');
    const before = Y.encodeStateVector(doc);
    setValue(sheet, 0, 0, 'same');
    expect(Y.encodeStateVector(doc)).toEqual(before);
  });
});

describe('sheets', () => {
  it('are listed in order, moved, and removed', () => {
    const { doc, sheetId } = newWorkbook(1, 1);
    const second = createSheet(doc, { name: 'Sheet2', rows: 1, columns: 1 });
    const first = createSheet(doc, { name: 'Sheet0', rows: 1, columns: 1, index: 0 });
    expect(readSheets(doc).map(({ id }) => id)).toEqual([first, sheetId, second]);
    moveSheet(doc, first, 2);
    expect(readSheets(doc).map(({ id }) => id)).toEqual([sheetId, second, first]);
    removeSheet(doc, second);
    expect(readSheets(doc).map(({ sheet }) => readSheetName(sheet))).toEqual(['Sheet1', 'Sheet0']);
  });

  it('stay removed when another device moved the sheet at the same time', () => {
    const { doc } = newWorkbook(1, 1);
    const second = createSheet(doc, { name: 'Sheet2', rows: 1, columns: 1 });
    const other = replicate(doc);
    removeSheet(doc, second);
    moveSheet(other, second, 0);
    sync(doc, other);
    expect(readSheets(doc).map(({ id }) => id)).not.toContain(second);
    expect(readSheets(other).map(({ id }) => id)).toEqual(readSheets(doc).map(({ id }) => id));
  });
});

describe('merges and rules', () => {
  it('keeps one of two overlapping merges made concurrently, the same one on both devices', () => {
    const { doc, sheetId } = newWorkbook(5, 5);
    const other = replicate(doc);
    addMerge(sheetOf(doc, sheetId), { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 });
    addMerge(sheetOf(other, sheetId), { startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 });
    sync(doc, other);
    const merges = readMerges(sheetOf(doc, sheetId));
    expect(merges).toHaveLength(1);
    expect(merges).toEqual(readMerges(sheetOf(other, sheetId)));
  });

  it('drops a merge that collapsed to one cell', () => {
    const { sheet } = newWorkbook(5, 5);
    addMerge(sheet, { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 });
    removeLines(sheet, 'rows', 1, 1);
    expect(readMerges(sheet)).toEqual([]);
  });

  it('resolves a rule through its anchored ranges and drops it when none survives', () => {
    const { sheet } = newWorkbook(5, 5);
    writeRule(sheet, {
      feature: 'conditional-format',
      ranges: [{ startRow: 1, endRow: 2, startColumn: 0, endColumn: 0 }],
      body: { type: 'highlight' },
    });
    insertLines(sheet, 'rows', 0, 1);
    expect(readRules(sheet, 'conditional-format')[0].ranges[0]).toMatchObject({ startRow: 2, endRow: 3 });
    removeLines(sheet, 'rows', 2, 2);
    expect(readRules(sheet)).toEqual([]);
  });
});

describe('the Univer workbook converter', () => {
  const identity = { unitId: 'unit', name: 'Budget', locale: 'enUS' as LocaleType, appVersion: '1.0.3' };

  const source: IWorkbookData = {
    id: 'unit',
    name: 'Budget',
    appVersion: '1.0.3',
    locale: 'enUS' as LocaleType,
    styles: { bold: { bl: 1 }, money: { n: { pattern: '#,##0.00' } } },
    sheetOrder: ['first', 'second'],
    sheets: {
      first: {
        id: 'first',
        name: 'Income',
        rowCount: 20,
        columnCount: 6,
        cellData: {
          0: { 0: { v: 'Month', t: 1, s: 'bold' }, 1: { v: 'Amount', t: 1, s: 'bold' } },
          1: { 0: { v: 'Jan', t: 1 }, 1: { v: 1200.5, t: 2, s: 'money' } },
          2: { 0: { v: 'Feb', t: 1 }, 1: { v: 980, t: 2, s: { n: { pattern: '#,##0.00' } } } },
          3: { 1: { f: '=SUM(B2:B3)', v: 2180.5, t: 2 } },
          4: { 2: { v: '0042', t: 4 } },
        },
        rowData: { 0: { h: 30 }, 5: { hd: 1 } },
        columnData: { 0: { w: 120 }, 3: { hd: 1 } },
        mergeData: [{ startRow: 6, endRow: 7, startColumn: 0, endColumn: 2 }],
        freeze: { xSplit: 0, ySplit: 1, startRow: 1, startColumn: -1 },
        tabColor: '#ff0000',
      },
      second: { id: 'second', name: 'Notes', rowCount: 3, columnCount: 2, cellData: {} },
    },
  };

  it('round-trips values, formulas, styles, sizes, merges and the freeze', () => {
    const doc = new Y.Doc();
    fromWorkbookData(doc, source, IDENTITY);
    const data = toWorkbookData(doc, identity, IDENTITY);
    const first = data.sheets.first!;

    expect(isSpreadsheet(doc)).toBe(true);
    expect(data.sheetOrder).toEqual(['first', 'second']);
    expect(first).toMatchObject({ name: 'Income', rowCount: 20, columnCount: 6, tabColor: '#ff0000' });
    expect(first.freeze).toEqual({ xSplit: 0, ySplit: 1, startRow: 1, startColumn: -1 });
    expect(first.rowData).toEqual({ 0: { h: 30 }, 5: { hd: 1 } });
    expect(first.columnData).toEqual({ 0: { w: 120 }, 3: { hd: 1 } });
    expect(first.mergeData).toEqual([{ startRow: 6, endRow: 7, startColumn: 0, endColumn: 2, rangeType: 0 }]);

    const cells = first.cellData!;
    expect(cells[0][0]).toMatchObject({ v: 'Month', t: 1 });
    expect(cells[1][1]).toMatchObject({ v: 1200.5, t: 2 });
    expect(cells[3][1]).toEqual({ f: '=SUM(B2:B3)' });
    expect(cells[4][2]).toEqual({ v: '0042', t: 4 });
    expect(data.styles[cells[0][0].s as string]).toEqual({ bl: 1 });
    expect(cells[1][1].s).toBe(cells[2][1].s);
    expect(data.styles[cells[1][1].s as string]).toEqual({ n: { pattern: '#,##0.00' } });
  });

  it('hands the codec the cell it is converting', () => {
    const seen: [string, number, number, string | undefined][] = [];
    const recording: FormulaCodec = {
      store: (formula, scope: FormulaScope) => {
        seen.push([scope.sheetId, scope.row, scope.column, scope.workbook.sheetName(scope.sheetId)]);
        return formula;
      },
      display: (stored) => stored,
    };
    fromWorkbookData(new Y.Doc(), source, recording);
    expect(seen).toEqual([['first', 3, 1, 'Income']]);
  });

  it('follows the rows another device inserted', () => {
    const doc = new Y.Doc();
    fromWorkbookData(doc, source, IDENTITY);
    const other = replicate(doc);
    insertLines(sheetOf(other, 'first'), 'rows', 0, 2);
    sync(doc, other);
    const cells = toWorkbookData(doc, identity, IDENTITY).sheets.first!.cellData!;
    expect(cells[2][0]).toMatchObject({ v: 'Month' });
    expect(cells[5][1]).toEqual({ f: '=SUM(B2:B3)' });
  });
});
