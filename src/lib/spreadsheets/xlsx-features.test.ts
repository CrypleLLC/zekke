import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { LocaleType } from '@univerjs/core';
import {
  BOUND_FEATURES,
  CONDITIONAL_FEATURE,
  FILTER_FEATURE,
  FILTER_RULE_KEY,
  FORMULA_CODEC,
  VALIDATION_FEATURE,
  cellsToRanges,
  createSheet,
  exportXlsx,
  featureRulesFromDoc,
  importSpreadsheet,
  markSpreadsheet,
  readSheetName,
  readSheets,
  toWorkbookData,
  writeFeatureRules,
  type FeatureRule,
} from './index';

const IDENTITY = { unitId: 'export', name: 'Rules', locale: 'enUS' as LocaleType, appVersion: '1.0.3' };

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(__dirname, '..', '..', 'test', 'fixtures', 'xlsx', name)));
}

async function imported(bytes: Uint8Array, fileName = 'book.xlsx') {
  const result = await importSpreadsheet(fileName, bytes);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, result.snapshot);
  return { doc, report: result.report };
}

function sheetIdNamed(doc: Y.Doc, name: string): string {
  return readSheets(doc).find(({ sheet }) => readSheetName(sheet) === name)!.id;
}

function features(doc: Y.Doc, sheetId: string) {
  return BOUND_FEATURES.flatMap((feature) => featureRulesFromDoc(doc, sheetId, feature, FORMULA_CODEC)).map(
    ({ feature, ranges, body, order }) => ({ feature, ranges, body, order }),
  );
}

async function roundTrip(rules: FeatureRule[]) {
  const doc = new Y.Doc();
  markSpreadsheet(doc);
  const sheetId = createSheet(doc, { name: 'Sheet1', rows: 50, columns: 10 });
  writeFeatureRules(doc, sheetId, rules, FORMULA_CODEC);
  const bytes = await exportXlsx(toWorkbookData(doc, IDENTITY, FORMULA_CODEC), doc);
  const back = await imported(bytes);
  return { before: features(doc, sheetId), after: features(back.doc, readSheets(back.doc)[0].id), report: back.report };
}

const cells = (startRow: number, endRow: number, startColumn: number, endColumn = startColumn) => ({
  startRow,
  endRow,
  startColumn,
  endColumn,
  rangeType: 0,
});

describe('features in an imported .xlsx', () => {
  it('brings in the corpus’ validation and conditional formats instead of counting them lost', async () => {
    const { doc, report } = await imported(fixture('corpus.xlsx'), 'corpus.xlsx');
    expect(report.dataValidations).toBeUndefined();
    expect(report.conditionalFormats).toBeUndefined();
    const rules = features(doc, sheetIdNamed(doc, 'Rules'));
    expect(rules.filter(({ feature }) => feature === VALIDATION_FEATURE)).toEqual([
      {
        feature: VALIDATION_FEATURE,
        ranges: [cells(0, 4, 1)],
        body: { type: 'list', formula1: 'Paid,Pending,Overdue', allowBlank: true },
        order: 0,
      },
    ]);
    const conditional = rules.filter(({ feature }) => feature === CONDITIONAL_FEATURE);
    expect(conditional).toHaveLength(2);
    expect(conditional.every(({ ranges }) => JSON.stringify(ranges) === JSON.stringify([cells(0, 4, 0)]))).toBe(true);
    const bodies = conditional.map(({ body }) => (body as { rule: Record<string, unknown> }).rule);
    expect(bodies).toContainEqual({
      type: 'highlightCell',
      subType: 'number',
      operator: 'greaterThan',
      value: 25,
      style: { bg: { rgb: '#ffc7ce' } },
    });
    expect(bodies).toContainEqual({
      type: 'colorScale',
      config: [
        { index: 0, color: '#ffffff', value: { type: 'min' } },
        { index: 1, color: '#63be7b', value: { type: 'max' } },
      ],
    });
  });

  it('round-trips the corpus’ rules through an export', async () => {
    const first = await imported(fixture('corpus.xlsx'), 'corpus.xlsx');
    const bytes = await exportXlsx(toWorkbookData(first.doc, IDENTITY, FORMULA_CODEC), first.doc);
    const second = await imported(bytes);
    expect(features(second.doc, sheetIdNamed(second.doc, 'Rules'))).toEqual(features(first.doc, sheetIdNamed(first.doc, 'Rules')));
  });
});

describe('features through an .xlsx round trip', () => {
  it('keeps validations: a list from a range, numbers, a custom formula, messages', async () => {
    const { before, after, report } = await roundTrip([
      { id: 'v1', feature: VALIDATION_FEATURE, ranges: [cells(1, 3, 0)], body: { type: 'list', formula1: '=$D$1:$D$3' }, order: 0 },
      {
        id: 'v2',
        feature: VALIDATION_FEATURE,
        ranges: [cells(1, 3, 1)],
        body: { type: 'whole', operator: 'between', formula1: '1', formula2: '10', showErrorMessage: true, error: 'One to ten', errorStyle: 2 },
        order: 1,
      },
      { id: 'v3', feature: VALIDATION_FEATURE, ranges: [cells(5, 6, 2, 3)], body: { type: 'custom', formula1: '=C6>B6' }, order: 2 },
    ]);
    expect(report).toEqual({});
    expect(after).toEqual(before);
  });

  it('keeps conditional formats in priority order: formulas, numbers, ranks, averages, scales, bars and icons', async () => {
    const red = { bg: { rgb: '#ff0000' }, bl: 1 };
    const rules: FeatureRule[] = [
      { type: 'highlightCell', subType: 'formula', value: '=A1>B1', style: red },
      { type: 'highlightCell', subType: 'number', operator: 'between', value: [1, 5], style: red },
      { type: 'highlightCell', subType: 'rank', isBottom: true, isPercent: false, value: 3, style: red },
      { type: 'highlightCell', subType: 'average', operator: 'lessThan', style: red },
      {
        type: 'colorScale',
        config: [
          { index: 0, color: '#ff0000', value: { type: 'min' } },
          { index: 1, color: '#ffff00', value: { type: 'percentile', value: 50 } },
          { index: 2, color: '#00ff00', value: { type: 'max' } },
        ],
      },
      {
        type: 'dataBar',
        isShowValue: true,
        config: { min: { type: 'num', value: 0 }, max: { type: 'max' }, isGradient: true, positiveColor: '#638ec6', nativeColor: '#ff0000' },
      },
      {
        type: 'iconSet',
        isShowValue: true,
        config: [
          { operator: 'greaterThanOrEqual', value: { type: 'percent', value: 67 }, iconType: '3Arrows', iconId: '0' },
          { operator: 'greaterThanOrEqual', value: { type: 'percent', value: 33 }, iconType: '3Arrows', iconId: '1' },
          { operator: 'lessThan', value: { type: 'percent', value: 33 }, iconType: '3Arrows', iconId: '2' },
        ],
      },
    ].map((rule, order) => ({ id: `c${order}`, feature: CONDITIONAL_FEATURE, ranges: [cells(0, 9, 0)], body: { stopIfTrue: false, rule }, order }));
    const { before, after, report } = await roundTrip(rules);
    expect(report).toEqual({});
    expect(after).toEqual(before);
  });

  it('writes text and duplicate rules as the formulas Excel evaluates', async () => {
    const { after } = await roundTrip([
      {
        id: 't',
        feature: CONDITIONAL_FEATURE,
        ranges: [cells(1, 4, 2)],
        body: { stopIfTrue: false, rule: { type: 'highlightCell', subType: 'text', operator: 'beginsWith', value: 'a"b', style: {} } },
        order: 0,
      },
      {
        id: 'd',
        feature: CONDITIONAL_FEATURE,
        ranges: [cells(1, 4, 2)],
        body: { stopIfTrue: false, rule: { type: 'highlightCell', subType: 'duplicateValues', style: {} } },
        order: 1,
      },
    ]);
    expect(after.map(({ body }) => (body as { rule: { value: string } }).rule.value)).toEqual([
      '=LEFT(C2,LEN("a""b"))="a""b"',
      '=COUNTIF($C$2:$C$5,C2)>1',
    ]);
  });

  it('keeps a filter’s range, which is all an .xlsx filter carries here', async () => {
    const { after } = await roundTrip([
      {
        id: FILTER_RULE_KEY,
        feature: FILTER_FEATURE,
        ranges: [cells(0, 9, 0, 3)],
        body: { filterColumns: [{ colId: 1, filters: { filters: ['x'] } }] },
        order: 0,
      },
    ]);
    expect(after).toEqual([{ feature: FILTER_FEATURE, ranges: [cells(0, 9, 0, 3)], body: { filterColumns: [] }, order: 0 }]);
  });
});

describe('cells grouped into ranges', () => {
  it('joins runs in a row, then identical runs down the rows', () => {
    const grid = [
      { row: 0, column: 1 },
      { row: 0, column: 2 },
      { row: 1, column: 1 },
      { row: 1, column: 2 },
      { row: 1, column: 5 },
      { row: 3, column: 1 },
      { row: 3, column: 2 },
    ];
    expect(cellsToRanges(grid)).toEqual([cells(0, 1, 1, 2), cells(1, 1, 5), cells(3, 3, 1, 2)]);
  });
});
