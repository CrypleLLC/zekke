import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { IWorkbookData, LocaleType } from '@univerjs/core';
import {
  FORMULA_CODEC,
  MAX_CELL_BYTES,
  SNAPSHOT_RAW_BYTES_LIMIT,
  cellsInBytes,
  checkCapacity,
  estimateWorkbookBytes,
  fromWorkbookData,
} from './index';
import { MAX_SNAPSHOT_CHARACTERS } from '@/lib/documents/records';

function workbook(rows: number, columns: number, cell: (row: number, column: number) => object): IWorkbookData {
  const cellData: Record<number, Record<number, object>> = {};
  for (let row = 0; row < rows; row += 1) {
    cellData[row] = {};
    for (let column = 0; column < columns; column += 1) {
      cellData[row][column] = cell(row, column);
    }
  }
  return {
    id: 'unit',
    name: 'Book',
    appVersion: '1.0.3',
    locale: 'enUS' as LocaleType,
    styles: { date: { n: { pattern: 'yyyy-mm-dd' } } },
    sheetOrder: ['s'],
    sheets: { s: { id: 's', name: 'Sheet1', rowCount: rows, columnCount: columns, cellData } },
  };
}

const WORDS = ['Paid', 'Pending', 'São Paulo', 'Lisboa', 'Invoice 2026-10'];

const SHAPES: [string, (row: number, column: number) => object][] = [
  ['numbers', (row, column) => ({ v: Math.round(row * column * 137.31) / 100, t: 2 })],
  ['short text', (row, column) => ({ v: WORDS[(row + column) % WORDS.length], t: 1 })],
  ['dated and styled', (row) => ({ v: 45000 + row, t: 2, s: 'date' })],
  ['formulas', (row) => ({ f: `=SUM(A${row + 1}:C${row + 1})*2` })],
  ['a mix', (row, column) => [{ v: row * 1.5, t: 2 }, { v: WORDS[row % 5], t: 1 }, { v: 45000 + row, t: 2, s: 'date' }, { f: `=A${row + 1}*2` }][column % 4]],
];

describe('the capacity estimate', () => {
  it.each(SHAPES)('never undercounts a sheet of %s, and stays within 60%% of the truth', (_, cell) => {
    const data = workbook(2000, 12, cell);
    const doc = new Y.Doc();
    fromWorkbookData(doc, data, FORMULA_CODEC);
    const actual = Y.encodeStateAsUpdate(doc).length;
    const estimate = estimateWorkbookBytes(data).bytes;
    expect(estimate).toBeGreaterThanOrEqual(actual);
    expect(estimate).toBeLessThanOrEqual(actual * 1.6);
  });

  it('puts the limit where the server’s snapshot ceiling is, once sealed and base64-encoded', () => {
    const sealedCharacters = Math.ceil(((SNAPSHOT_RAW_BYTES_LIMIT + 29) * 4) / 3);
    expect(sealedCharacters).toBeLessThanOrEqual(MAX_SNAPSHOT_CHARACTERS);
    expect(sealedCharacters).toBeGreaterThan(MAX_SNAPSHOT_CHARACTERS - 1024);
    expect(cellsInBytes(SNAPSHOT_RAW_BYTES_LIMIT)).toBeGreaterThan(190_000);
    expect(cellsInBytes(SNAPSHOT_RAW_BYTES_LIMIT)).toBeLessThan(230_000);
  });

  it('refuses a workbook past the limit, and a cell larger than one delta can carry', () => {
    expect(checkCapacity(1000, 2000, 10, 2500)).toMatchObject({ reason: 'workbook-full' });
    expect(checkCapacity(1000, 1000, 10, 2500)).toBeUndefined();
    expect(checkCapacity(0, 10, MAX_CELL_BYTES + 1)).toMatchObject({ reason: 'cell-too-large' });
  });

  it('counts the cells of an import', () => {
    const { largestCellBytes } = estimateWorkbookBytes(workbook(2, 2, () => ({ v: 'x'.repeat(1000), t: 1 })));
    expect(largestCellBytes).toBe(1002);
  });
});
