import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { LocaleType } from '@univerjs/core';
import { readTitle, writeTitle } from '@/lib/documents/content';
import {
  BOUND_FEATURES,
  CONDITIONAL_FEATURE,
  DEFAULT_CHART_SETTINGS,
  FILTER_FEATURE,
  FILTER_RULE_KEY,
  FORMULA_CODEC,
  SHEET_PAGE_SETUP,
  addPageBreak,
  applyOperations,
  createSheet,
  defaultPageSetup,
  featureRulesFromDoc,
  insertLines,
  isSpreadsheet,
  markSpreadsheet,
  readAxis,
  readCharts,
  readMerges,
  readNames,
  readPrintSettings,
  readSheet,
  readSheets,
  rebuildSpreadsheet,
  removeLines,
  toWorkbookData,
  WorkbookIndex,
  writeChart,
  writeFeatureRules,
  writeName,
  writePageSetup,
  writePrintArea,
  writePrintTitles,
  type Operation,
  type SheetMap,
} from './index';

const IDENTITY = { unitId: 'u', name: 'Book', locale: 'enUS' as LocaleType, appVersion: '1.0.3' };

function book(): { doc: Y.Doc; sheetId: string; sheet: SheetMap } {
  const doc = new Y.Doc();
  markSpreadsheet(doc);
  writeTitle(doc, 'Budget');
  const sheetId = createSheet(doc, { name: 'Sheet1', rows: 30, columns: 8 });
  return { doc, sheetId, sheet: readSheet(doc, sheetId)! };
}

function setCells(doc: Y.Doc, sheetId: string, cells: [number, number, unknown][], style?: Record<string, unknown>): void {
  const sheet = readSheet(doc, sheetId)!;
  const rows = readAxis(sheet, 'rows');
  const columns = readAxis(sheet, 'columns');
  const operations: Operation[] = cells.map(([row, column, value]) => ({
    kind: 'cell',
    sheetId,
    rowId: rows.idAt(row)!,
    columnId: columns.idAt(column)!,
    content: (typeof value === 'string' && value.startsWith('=')
      ? { f: FORMULA_CODEC.store(value, { sheetId, row, column, workbook: new WorkbookIndex(doc) }) }
      : value) as never,
    ...(style === undefined ? {} : { style }),
  }));
  applyOperations(doc, operations);
}

function everything(doc: Y.Doc) {
  const data = toWorkbookData(doc, IDENTITY, FORMULA_CODEC);
  return {
    title: readTitle(doc),
    spreadsheet: isSpreadsheet(doc),
    workbook: { ...data, styles: Object.values(data.styles).map((style) => JSON.stringify(style)).sort() },
    names: [...readNames(doc).values()].map((name) => ({
      ...name,
      formula: FORMULA_CODEC.display(name.formula, {
        sheetId: name.sheetId ?? readSheets(doc)[0].id,
        row: 0,
        column: 0,
        workbook: new WorkbookIndex(doc),
      }),
    })),
    sheets: readSheets(doc).map(({ id, sheet }) => ({
      id,
      charts: readCharts(sheet),
      print: readPrintSettings(sheet),
      setup: sheet.get(SHEET_PAGE_SETUP),
      merges: readMerges(sheet).map(({ range }) => range),
      features: BOUND_FEATURES.flatMap((feature) => featureRulesFromDoc(doc, id, feature, FORMULA_CODEC)),
    })),
  };
}

describe('a spreadsheet rebuilt without its history', () => {
  it('reads exactly as the original, everything that is stored included', () => {
    const { doc, sheetId, sheet } = book();
    setCells(doc, sheetId, [
      [0, 0, 'Month'],
      [1, 0, 10],
      [2, 0, 20],
      [3, 0, 30],
      [4, 0, 40],
      [6, 0, '=SUM(A2:A5)'],
      [7, 0, '=A3*2'],
      [8, 0, { v: '007', t: 4 }],
    ]);
    setCells(doc, sheetId, [[0, 1, 'Styled']], { bl: 1, bg: { rgb: '#ff0000' } });
    applyOperations(doc, [
      { kind: 'line', sheetId, dimension: 'columns', id: readAxis(sheet, 'columns').idAt(1)!, properties: { size: 140 } },
      { kind: 'line', sheetId, dimension: 'rows', id: readAxis(sheet, 'rows').idAt(2)!, properties: { hidden: true } },
      { kind: 'sheet-property', sheetId, key: 'freeze', value: { xSplit: 1, ySplit: 1, startRow: 1, startColumn: 1 } },
      { kind: 'merges', sheetId, merges: [] },
    ]);
    applyOperations(doc, [
      {
        kind: 'merges',
        sheetId,
        merges: [{ startRow: readAxis(sheet, 'rows').idAt(10)!, endRow: readAxis(sheet, 'rows').idAt(11)!, startColumn: readAxis(sheet, 'columns').idAt(2)!, endColumn: readAxis(sheet, 'columns').idAt(3)! }],
      },
    ]);
    writeChart(sheet, 'chart00001', {
      settings: { ...DEFAULT_CHART_SETTINGS, title: 'Spend' },
      source: { startRow: 0, endRow: 4, startColumn: 0, endColumn: 0 },
      anchor: { from: { row: 1, column: 3, rowOffset: 4, columnOffset: 6 }, to: { row: 12, column: 6, rowOffset: 0, columnOffset: 0 } },
    });
    writePrintArea(sheet, { startRow: 0, endRow: 8, startColumn: 0, endColumn: 3 });
    writePrintTitles(sheet, 'rows', { start: 0, end: 0 });
    addPageBreak(sheet, 'rows', 5);
    writePageSetup(sheet, { ...defaultPageSetup('a4'), orientation: 'landscape' });
    writeFeatureRules(
      doc,
      sheetId,
      [
        { id: 'cf1', feature: CONDITIONAL_FEATURE, ranges: [{ startRow: 1, endRow: 4, startColumn: 0, endColumn: 0 }], body: { stopIfTrue: false, rule: { type: 'highlightCell', subType: 'formula', value: '=A2>$A$4', style: {} } }, order: 0 },
        { id: FILTER_RULE_KEY, feature: FILTER_FEATURE, ranges: [{ startRow: 0, endRow: 8, startColumn: 0, endColumn: 2 }], body: { filterColumns: [{ colId: 1, filters: { filters: ['x'] } }] }, order: 0 },
      ],
      FORMULA_CODEC,
    );
    writeName(doc, 'n1', { name: 'Total', formula: FORMULA_CODEC.store('=Sheet1!$A$7', { sheetId, row: 0, column: 0, workbook: new WorkbookIndex(doc) }) });

    removeLines(sheet, 'rows', 4, 1);
    removeLines(sheet, 'rows', 2, 1);
    insertLines(sheet, 'rows', 1, 2);
    removeLines(sheet, 'columns', 7, 1);

    const before = everything(doc);
    const rebuilt = rebuildSpreadsheet(doc);
    expect(everything(rebuilt)).toEqual(before);
    expect(JSON.stringify(before.workbook)).toContain('#REF!');
  });

  it('shrinks a sheet overwritten many times back to the size of its content', () => {
    const { doc, sheetId, sheet } = book();
    for (let round = 0; round < 40; round += 1) {
      const rows = readAxis(sheet, 'rows');
      const columns = readAxis(sheet, 'columns');
      const operations: Operation[] = [];
      for (let row = 0; row < 25; row += 1) {
        for (let column = 0; column < 8; column += 1) {
          operations.push({ kind: 'cell', sheetId, rowId: rows.idAt(row)!, columnId: columns.idAt(column)!, content: round * 1000 + row * 8 + column });
        }
      }
      applyOperations(doc, operations);
      insertLines(sheet, 'rows', 0, 1);
      removeLines(sheet, 'rows', 0, 1);
    }
    const fresh = book();
    const rows = readAxis(fresh.sheet, 'rows');
    const columns = readAxis(fresh.sheet, 'columns');
    const operations: Operation[] = [];
    for (let row = 0; row < 25; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        operations.push({ kind: 'cell', sheetId: fresh.sheetId, rowId: rows.idAt(row)!, columnId: columns.idAt(column)!, content: 39 * 1000 + row * 8 + column });
      }
    }
    applyOperations(fresh.doc, operations);

    const original = Y.encodeStateAsUpdate(doc).length;
    const rebuilt = Y.encodeStateAsUpdate(rebuildSpreadsheet(doc)).length;
    const content = Y.encodeStateAsUpdate(fresh.doc).length;
    expect(rebuilt).toBeLessThan(original / 3);
    expect(rebuilt).toBeLessThan(content * 1.1);
    expect(readAxis(readSheet(rebuildSpreadsheet(doc), sheetId)!, 'rows').allIds().size).toBe(30);
  });

  it('keeps every sheet in order, and drops what no sheet uses', () => {
    const { doc, sheetId } = book();
    const second = createSheet(doc, { name: 'Data', rows: 5, columns: 3 });
    const third = createSheet(doc, { name: 'Gone', rows: 5, columns: 3 });
    setCells(doc, second, [[0, 0, 'kept']], { it: 1 });
    setCells(doc, third, [[0, 0, 'dropped']], { st: { s: 1 } });
    applyOperations(doc, [{ kind: 'remove-sheet', sheetId: third }]);
    const rebuilt = rebuildSpreadsheet(doc);
    expect(readSheets(rebuilt).map(({ id }) => id)).toEqual([sheetId, second]);
    expect(rebuilt.getMap('styles').size).toBe(1);
  });
});
