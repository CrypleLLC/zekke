import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { ICellData, IStyleData, IWorkbookData, LocaleType } from '@univerjs/core';
import { readTitle } from '@/lib/documents/content';
import {
  FORMULA_CODEC,
  ImportTooLargeError,
  UnsupportedFormatError,
  addFunctionPrefixes,
  dateToSerial,
  delimitedCell,
  delimitedToWorkbookData,
  detectDelimiter,
  exportDelimited,
  exportFileName,
  exportXlsx,
  importSpreadsheet,
  isSpreadsheet,
  parseDelimited,
  readNames,
  readXlsx,
  sheetToDelimited,
  stripFunctionPrefixes,
  toWorkbookData,
  WorkbookIndex,
} from './index';

const FIXTURES = join(__dirname, '..', '..', 'test', 'fixtures', 'xlsx');
const IDENTITY = { unitId: 'unit', name: 'Corpus', locale: 'enUS' as LocaleType, appVersion: '1.0.3' };

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

async function importedDoc(name: string): Promise<Y.Doc> {
  const { snapshot } = await importSpreadsheet(name, fixture(name));
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot);
  return doc;
}

function sheetNamed(workbook: IWorkbookData, name: string) {
  const id = workbook.sheetOrder.find((sheetId) => workbook.sheets[sheetId]?.name === name);
  expect(id, `sheet ${name}`).toBeDefined();
  return workbook.sheets[id as string]!;
}

function cellAt(workbook: IWorkbookData, sheet: string, address: string): ICellData {
  const column = address.charCodeAt(0) - 65;
  const row = Number(address.slice(1)) - 1;
  return (sheetNamed(workbook, sheet).cellData?.[row]?.[column] ?? {}) as ICellData;
}

function styleAt(workbook: IWorkbookData, sheet: string, address: string): IStyleData {
  const s = cellAt(workbook, sheet, address).s;
  return (typeof s === 'string' ? workbook.styles[s] : s) ?? {};
}

describe('importing the xlsx corpus', () => {
  it('keeps values: text, numbers, booleans, dates as serials with their format, and forced text', async () => {
    const workbook = toWorkbookData(await importedDoc('corpus.xlsx'), IDENTITY, FORMULA_CODEC);
    expect(cellAt(workbook, 'Values', 'B1')).toMatchObject({ v: 'Açaí – São Paulo ✓', t: 1 });
    expect(cellAt(workbook, 'Values', 'B2')).toMatchObject({ v: 42, t: 2 });
    expect(cellAt(workbook, 'Values', 'B3')).toMatchObject({ v: -1234.5678 });
    expect(cellAt(workbook, 'Values', 'B4')).toMatchObject({ v: true, t: 3 });
    expect(cellAt(workbook, 'Values', 'B5')).toMatchObject({ v: dateToSerial(new Date(Date.UTC(2026, 9, 4))) });
    expect(styleAt(workbook, 'Values', 'B5').n).toEqual({ pattern: 'yyyy-mm-dd' });
    expect(cellAt(workbook, 'Values', 'B6')).toMatchObject({ v: '0042', t: 4 });
    expect((cellAt(workbook, 'Values', 'B7').v as string).length).toBe(300);
    expect(cellAt(workbook, 'Values', 'B9')).toMatchObject({ v: 'Zekke' });
  });

  it('keeps formulas, expanding the shared one and dropping Excel’s function prefixes', async () => {
    const workbook = toWorkbookData(await importedDoc('corpus.xlsx'), IDENTITY, FORMULA_CODEC);
    const formula = (address: string) => cellAt(workbook, 'Data 2024', address).f;
    expect([formula('B1'), formula('B2'), formula('B3')]).toEqual(['=A1*2', '=A2*2', '=A3*2']);
    expect(formula('A5')).toBe('=SUM(A1:A3)');
    expect(formula('A6')).toBe('=$A$1+A2');
    expect(formula('A7')).toBe('=Values!B2*2');
    expect(formula('A8')).toBe("='Data 2024'!A1");
    expect(formula('A9')).toBe('=IF(A1>1000,"big","small")');
    expect(formula('A10')).toBe('=XLOOKUP(450.5,A1:A3,B1:B3)');
    expect(formula('A11')).toBe('=Total*1');
  });

  it('keeps defined names, anchored like a formula', async () => {
    const doc = await importedDoc('corpus.xlsx');
    const [name] = [...readNames(doc).values()];
    expect(name.name).toBe('Total');
    const workbook = new WorkbookIndex(doc);
    expect(FORMULA_CODEC.display(name.formula, { sheetId: workbook.sheetIds()[0], row: 0, column: 0, workbook })).toBe(
      "'Data 2024'!$A$5",
    );
  });

  it('keeps styles and number formats', async () => {
    const workbook = toWorkbookData(await importedDoc('corpus.xlsx'), IDENTITY, FORMULA_CODEC);
    expect(styleAt(workbook, 'Styles', 'A1')).toMatchObject({ bl: 1 });
    expect(styleAt(workbook, 'Styles', 'A2')).toMatchObject({ it: 1, ul: { s: 1 }, st: { s: 1 } });
    expect(styleAt(workbook, 'Styles', 'A3')).toMatchObject({ ff: 'Arial', fs: 14, cl: { rgb: '#FF0000' } });
    expect(styleAt(workbook, 'Styles', 'A4')).toMatchObject({ bg: { rgb: '#FFFF00' } });
    expect(styleAt(workbook, 'Styles', 'A5').bd).toEqual({
      t: { s: 1, cl: { rgb: '#000000' } },
      b: { s: 13, cl: { rgb: '#0000FF' } },
      l: { s: 4, cl: { rgb: '#00FF00' } },
      r: { s: 7, cl: { rgb: '#000000' } },
    });
    expect(styleAt(workbook, 'Styles', 'A6')).toMatchObject({ ht: 2, vt: 2, tb: 3 });
    expect(styleAt(workbook, 'Styles', 'A7').n).toEqual({ pattern: '"R$" #,##0.00' });
    expect(styleAt(workbook, 'Styles', 'A8').n).toEqual({ pattern: '0.0%' });
    expect(styleAt(workbook, 'Styles', 'A10')).toMatchObject({ ht: 3, vt: 1 });
    expect(styleAt(workbook, 'Values', 'B2')).toEqual({});
  });

  it('keeps merges, the freeze, sizes, hidden lines, the tab colour, a hidden sheet and the sheet order', async () => {
    const workbook = toWorkbookData(await importedDoc('corpus.xlsx'), IDENTITY, FORMULA_CODEC);
    expect(workbook.sheetOrder.map((id) => workbook.sheets[id]!.name)).toEqual(['Values', 'Data 2024', 'Styles', 'Layout', 'Rules', 'Hidden']);
    const layout = sheetNamed(workbook, 'Layout');
    expect(layout.mergeData).toEqual([{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 2, rangeType: 0 }]);
    expect(layout.freeze).toEqual({ xSplit: 1, ySplit: 3, startRow: 3, startColumn: 1 });
    expect(layout.columnData?.[0]).toEqual({ w: 215 });
    expect(layout.columnData?.[1]).toEqual({ w: 61 });
    expect(layout.columnData?.[3]).toMatchObject({ hd: 1 });
    expect(layout.rowData?.[4]).toEqual({ h: 53 });
    expect(layout.rowData?.[5]).toMatchObject({ hd: 1 });
    expect(layout.tabColor).toBe('#00AA00');
    expect(sheetNamed(workbook, 'Hidden').hidden).toBe(1);
    expect(cellAt(workbook, 'Layout', 'B1')).toEqual({});
  });

  it('names what it could not bring in', async () => {
    const { report, sheets } = await importSpreadsheet('corpus.xlsx', fixture('corpus.xlsx'));
    expect(sheets).toBe(6);
    expect(report).toEqual({ comments: 1, hyperlinks: 1 });
  });

  it('is a spreadsheet titled after the file', async () => {
    const doc = await importedDoc('corpus.xlsx');
    expect(isSpreadsheet(doc)).toBe(true);
    expect(readTitle(doc)).toBe('corpus');
  });
});

describe('the xlsx round trip', () => {
  function comparable(workbook: IWorkbookData) {
    return workbook.sheetOrder.map((id) => {
      const sheet = workbook.sheets[id]!;
      const cells: Record<string, unknown> = {};
      for (const [row, columns] of Object.entries(sheet.cellData ?? {})) {
        for (const [column, cell] of Object.entries(columns as Record<string, ICellData>)) {
          const style = typeof cell.s === 'string' ? workbook.styles[cell.s] : cell.s;
          cells[`${row}:${column}`] = { v: cell.v, t: cell.t, f: cell.f, s: style ?? undefined };
        }
      }
      return {
        name: sheet.name,
        cells,
        merges: sheet.mergeData,
        freeze: sheet.freeze,
        rows: sheet.rowData,
        columns: sheet.columnData,
        hidden: sheet.hidden,
        tab: sheet.tabColor,
      };
    });
  }

  it('reads back what it wrote, sheet by sheet and cell by cell', async () => {
    const doc = await importedDoc('corpus.xlsx');
    const first = toWorkbookData(doc, IDENTITY, FORMULA_CODEC);
    const written = await exportXlsx(first, doc);
    const again = await readXlsx(written, IDENTITY);

    const second = new Y.Doc();
    const { snapshot } = await importSpreadsheet('again.xlsx', written);
    Y.applyUpdate(second, snapshot);
    expect(comparable(toWorkbookData(second, IDENTITY, FORMULA_CODEC))).toEqual(comparable(first));
    expect(again.names).toEqual([{ name: 'Total', formula: "'Data 2024'!$A$5" }]);
    expect(again.report).toEqual({});
  });

  it('writes Excel’s prefix back on functions newer than 2010, and only on those', () => {
    expect(addFunctionPrefixes('XLOOKUP(1,A1:A3,B1:B3)+sum(textjoin(",",TRUE,A1:A2))')).toBe(
      '_xlfn.XLOOKUP(1,A1:A3,B1:B3)+sum(_xlfn.TEXTJOIN(",",TRUE,A1:A2))',
    );
    expect(addFunctionPrefixes('MYXLOOKUP(1)+SUM(A1)')).toBe('MYXLOOKUP(1)+SUM(A1)');
    expect(stripFunctionPrefixes('_xlfn._xlws.FILTER(A1:A3,B1:B3)+_xlfn.XLOOKUP(1,A1,B1)')).toBe('FILTER(A1:A3,B1:B3)+XLOOKUP(1,A1,B1)');
  });

  it('keeps a formula’s cached result, so Excel shows it before recalculating', async () => {
    const workbook: IWorkbookData = {
      ...IDENTITY,
      id: 'unit',
      styles: {},
      sheetOrder: ['s'],
      sheets: { s: { id: 's', name: 'Sheet1', cellData: { 0: { 0: { v: 2, t: 2 }, 1: { f: '=A1*3', v: 6, t: 2 } } } } },
    };
    const again = await readXlsx(await exportXlsx(workbook, new Y.Doc()), IDENTITY);
    const sheet = again.workbook.sheets[again.workbook.sheetOrder[0]]!;
    expect(sheet.cellData?.[0]?.[1]).toMatchObject({ f: '=A1*3' });
  });
});

describe('CSV and TSV', () => {
  it('parses quotes, embedded delimiters, quotes and newlines, and both line endings', () => {
    const rows = parseDelimited(new TextDecoder().decode(fixture('corpus.csv')));
    expect(rows).toEqual([
      ['name', 'amount', 'note'],
      ['Smith, John', '1200.50', 'line one\nline two'],
      ["O'Brien", '-3', 'says "hi"'],
      ['=1+1', '0042', ''],
    ]);
  });

  it('detects the delimiter, ignoring the ones inside quotes', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('nome;valor\n"a,b";1,5')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('﻿a;b;c')).toBe(';');
  });

  it.each([
    ['1200.50', { v: 1200.5, t: 2 }],
    ['-3', { v: -3, t: 2 }],
    ['1e3', { v: 1000, t: 2 }],
    ['0042', { v: '0042', t: 4 }],
    ['1.234,56', { v: '1.234,56', t: 4 }],
    ['TRUE', { v: true, t: 3 }],
    ['=1+1', { v: '=1+1', t: 4 }],
    ['@SUM(A1)', { v: '@SUM(A1)', t: 4 }],
    ['-abc', { v: '-abc', t: 4 }],
    ['São Paulo', { v: 'São Paulo', t: 1 }],
    ['', undefined],
  ])('types %j conservatively, and never as a formula', (text, cell) => {
    expect(delimitedCell(text)).toEqual(cell);
  });

  it('imports a TSV, keeping accents', async () => {
    const doc = await importedDoc('corpus.tsv');
    const workbook = toWorkbookData(doc, IDENTITY, FORMULA_CODEC);
    expect(cellAt(workbook, 'Sheet1', 'A2')).toMatchObject({ v: 'Açaí' });
    expect(cellAt(workbook, 'Sheet1', 'B2')).toMatchObject({ v: 3.5, t: 2 });
  });

  it('exports values, quoting what needs it and defusing what a spreadsheet would run', () => {
    const workbook = delimitedToWorkbookData(new TextDecoder().decode(fixture('corpus.csv')), { ...IDENTITY, name: 'csv' });
    const sheetId = workbook.sheetOrder[0];
    workbook.sheets[sheetId]!.cellData![5] = { 0: { f: '=SUM(B2:B3)', v: 1197.5, t: 2 }, 1: { v: '+cmd', t: 1 } };
    expect(exportDelimited(workbook, sheetId, ',')).toBe(
      'name,amount,note\r\n"Smith, John",1200.5,"line one\nline two"\r\nO\'Brien,-3,"says ""hi"""\r\n\'=1+1,0042,\r\n,,\r\n1197.5,\'+cmd,\r\n',
    );
  });

  it('writes TSV with tabs', () => {
    expect(sheetToDelimited({ cellData: { 0: { 0: { v: 'a\tb' }, 1: { v: 2 } } } }, '\t')).toBe('"a\tb"\t2\r\n');
  });
});

describe('refusals', () => {
  it('refuses a file past the capacity before building anything', async () => {
    const rows = Array.from({ length: 30_000 }, (_, row) => Array.from({ length: 12 }, (_, column) => `${row}.${column}`).join(',')).join('\n');
    await expect(importSpreadsheet('big.csv', new TextEncoder().encode(rows))).rejects.toBeInstanceOf(ImportTooLargeError);
  });

  it('refuses a format it does not read', async () => {
    await expect(importSpreadsheet('report.ods', new Uint8Array([1, 2]))).rejects.toBeInstanceOf(UnsupportedFormatError);
  });

  it('names an export after the spreadsheet, without characters a file system refuses', () => {
    expect(exportFileName('Budget: 2026/Q4', 'xlsx', 'Spreadsheet')).toBe('Budget 2026 Q4.xlsx');
    expect(exportFileName('   ', 'csv', 'Spreadsheet')).toBe('Spreadsheet.csv');
  });
});
