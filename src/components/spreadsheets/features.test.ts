import { afterEach, describe, expect, it } from 'vitest';
import { Direction } from '@univerjs/core';
import { DataValidationModel } from '@univerjs/data-validation';
import { InsertColCommand, InsertRowCommand, RemoveRowCommand } from '@univerjs/sheets';
import { ConditionalFormattingRuleModel } from '@univerjs/sheets-conditional-formatting';
import { SheetsFilterService } from '@univerjs/sheets-filter';
import { CONDITIONAL_FEATURE, FILTER_FEATURE, VALIDATION_FEATURE, readRules, readSheet } from '@/lib/spreadsheets';
import { UNIT, device, disposeDevices, expectConverged, pair, rowRange, set, sync, workbookOf, type Device } from '@/test/spreadsheets';

afterEach(disposeDevices);

const FEATURES = { features: true };

function conditionalRules(device: Device) {
  return device.univer.__getInjector().get(ConditionalFormattingRuleModel).getSubunitRules(UNIT, device.sheetId) ?? [];
}

function validationRules(device: Device) {
  return device.univer.__getInjector().get(DataValidationModel).getRules(UNIT, device.sheetId);
}

function filterModel(device: Device) {
  return device.univer.__getInjector().get(SheetsFilterService).getFilterModel(UNIT, device.sheetId);
}

function bare(range: { startRow: number; endRow: number; startColumn: number; endColumn: number }) {
  return { startRow: range.startRow, endRow: range.endRow, startColumn: range.startColumn, endColumn: range.endColumn };
}

function cells(startRow: number, endRow: number, startColumn: number, endColumn = startColumn) {
  return { startRow, endRow, startColumn, endColumn };
}

const RED = { bg: { rgb: '#ff0000' } };
const BLUE = { bg: { rgb: '#0000ff' } };

async function addFormulaRule(device: Device, cfId: string, range: ReturnType<typeof cells>, formula: string, style = RED) {
  await device.commands.executeCommand('sheet.mutation.add-conditional-rule', {
    unitId: UNIT,
    subUnitId: device.sheetId,
    rule: {
      cfId,
      ranges: [range],
      stopIfTrue: false,
      rule: { type: 'highlightCell', subType: 'formula', value: formula, style },
    },
  });
}

async function insertRow(device: Device, row: number) {
  await device.commands.executeCommand(InsertRowCommand.id, {
    unitId: UNIT,
    subUnitId: device.sheetId,
    range: rowRange(device, row),
    direction: Direction.UP,
  });
}

async function insertColumn(device: Device, column: number) {
  const rows = workbookOf(device).getSheetBySheetId(device.sheetId)!.getRowCount();
  await device.commands.executeCommand(InsertColCommand.id, {
    unitId: UNIT,
    subUnitId: device.sheetId,
    range: { startRow: 0, endRow: rows - 1, startColumn: column, endColumn: column, rangeType: 2 },
    direction: Direction.LEFT,
  });
}

describe('conditional formatting between two devices', () => {
  it('stores a rule by ids, with its formula through the codec, and shows it on the other device', async () => {
    const [a, b] = pair(20, 6, FEATURES);
    await addFormulaRule(a, 'cf1', cells(0, 9, 0), '=A1>5');
    const [stored] = readRules(readSheet(a.doc, a.sheetId)!, CONDITIONAL_FEATURE);
    expect(stored.id).toBe('cf:cf1');
    expect(JSON.stringify(stored.body)).toContain('⟦cell|');
    sync(a, b);
    expect(conditionalRules(b)).toHaveLength(1);
    expect(bare(conditionalRules(b)[0].ranges[0])).toEqual(cells(0, 9, 0));
    expect(conditionalRules(b)[0].rule).toMatchObject({ subType: 'formula', value: '=A1>5' });
  });

  it('grows the rule and keeps its formula on its first cell when the other device inserts a row inside it', async () => {
    const [a, b] = pair(20, 6, FEATURES);
    await set(a, 0, 0, 1);
    sync(a, b);
    await addFormulaRule(a, 'cf1', cells(2, 9, 0), '=A3>5');
    await insertRow(b, 4);
    sync(a, b);
    expectConverged(a, b);
    for (const device of [a, b]) {
      const [rule] = conditionalRules(device);
      expect(bare(rule.ranges[0])).toEqual(cells(2, 10, 0));
      expect(rule.rule).toMatchObject({ value: '=A3>5' });
    }
  });

  it('follows a row inserted above it on the other device', async () => {
    const [a, b] = pair(20, 6, FEATURES);
    await addFormulaRule(a, 'cf1', cells(2, 9, 0), '=A3>5');
    await insertRow(b, 0);
    sync(a, b);
    for (const device of [a, b]) {
      const [rule] = conditionalRules(device);
      expect(bare(rule.ranges[0])).toEqual(cells(3, 10, 0));
      expect(rule.rule).toMatchObject({ value: '=A4>5' });
    }
  });

  it('converges when one device trims the range and the other changes the style', async () => {
    const [a, b] = pair(20, 6, FEATURES);
    await addFormulaRule(a, 'cf1', cells(0, 9, 0), '=A1>5');
    sync(a, b);
    await b.commands.executeCommand(RemoveRowCommand.id, { unitId: UNIT, subUnitId: b.sheetId, range: rowRange(b, 7, 12) });
    await a.commands.executeCommand('sheet.mutation.set-conditional-rule', {
      unitId: UNIT,
      subUnitId: a.sheetId,
      cfId: 'cf1',
      rule: { cfId: 'cf1', ranges: [cells(0, 9, 0)], stopIfTrue: false, rule: { type: 'highlightCell', subType: 'formula', value: '=A1>5', style: BLUE } },
    });
    sync(a, b);
    expectConverged(a, b);
    const views = [a, b].map((device) => conditionalRules(device).map((rule) => ({ range: bare(rule.ranges[0]), rule: rule.rule })));
    expect(views[0]).toEqual(views[1]);
    expect(views[0]).toHaveLength(1);
    expect(views[0][0].range.endRow).toBeLessThan(9);
  });

  it('keeps the priority of several rules, and undoes an addition on both devices', async () => {
    const [a, b] = pair(20, 6, FEATURES);
    await addFormulaRule(a, 'low', cells(0, 4, 0), '=A1>1');
    a.binding.undoManager.stopCapturing();
    await addFormulaRule(a, 'high', cells(0, 4, 0), '=A1>2', BLUE);
    sync(a, b);
    expect(conditionalRules(b).map((rule) => rule.cfId)).toEqual(conditionalRules(a).map((rule) => rule.cfId));
    expect(conditionalRules(b).map((rule) => rule.cfId)).toEqual(['high', 'low']);
    a.binding.undo();
    sync(a, b);
    expect(conditionalRules(a).map((rule) => rule.cfId)).toEqual(['low']);
    expect(conditionalRules(b).map((rule) => rule.cfId)).toEqual(['low']);
  });

  it('removes a rule on the other device', async () => {
    const [a, b] = pair(20, 6, FEATURES);
    await addFormulaRule(a, 'cf1', cells(0, 4, 0), '=A1>1');
    sync(a, b);
    await b.commands.executeCommand('sheet.mutation.delete-conditional-rule', { unitId: UNIT, subUnitId: b.sheetId, cfId: 'cf1' });
    sync(a, b);
    expect(conditionalRules(a)).toEqual([]);
    expect(readRules(readSheet(a.doc, a.sheetId)!, CONDITIONAL_FEATURE)).toEqual([]);
  });
});

describe('data validation between two devices', () => {
  async function addListRule(device: Device, uid: string, range: ReturnType<typeof cells>, formula: string) {
    await device.commands.executeCommand('data-validation.mutation.addRule', {
      unitId: UNIT,
      subUnitId: device.sheetId,
      rule: { uid, type: 'list', ranges: [range], formula1: formula, allowBlank: true },
    });
  }

  it('moves the rule and the range it lists from when the other device inserts a column', async () => {
    const [a, b] = pair(20, 6, FEATURES);
    await addListRule(a, 'dv1', cells(1, 4, 1), '=$D$1:$D$3');
    await insertColumn(b, 0);
    sync(a, b);
    expectConverged(a, b);
    for (const device of [a, b]) {
      const [rule] = validationRules(device);
      expect(rule.uid).toBe('dv1');
      expect(bare(rule.ranges[0])).toEqual(cells(1, 4, 2));
      expect(rule.formula1).toBe('=$E$1:$E$3');
    }
  });

  it('keeps a list written as text exactly as typed', async () => {
    const [a, b] = pair(20, 6, FEATURES);
    await addListRule(a, 'dv1', cells(0, 2, 0), 'Yes,No,A1');
    sync(a, b);
    expect(validationRules(b)[0].formula1).toBe('Yes,No,A1');
  });

  it('converges when the other device trims the rule', async () => {
    const [a, b] = pair(20, 6, FEATURES);
    await addListRule(a, 'dv1', cells(2, 8, 0), 'x,y');
    sync(a, b);
    await b.commands.executeCommand(RemoveRowCommand.id, { unitId: UNIT, subUnitId: b.sheetId, range: rowRange(b, 6, 10) });
    await a.commands.executeCommand('data-validation.mutation.updateRule', {
      unitId: UNIT,
      subUnitId: a.sheetId,
      ruleId: 'dv1',
      payload: { type: 2, payload: { showErrorMessage: true, error: 'Pick x or y' } },
    });
    sync(a, b);
    expectConverged(a, b);
    const views = [a, b].map((device) => validationRules(device).map((rule) => ({ range: bare(rule.ranges[0]), error: rule.error })));
    expect(views[0]).toEqual(views[1]);
    expect(views[0]).toEqual([{ range: cells(2, 5, 0), error: 'Pick x or y' }]);
  });
});

describe('a filter between two devices', () => {
  it('keeps its criteria on the same column when the other device inserts one before it, and hides the same rows', async () => {
    const [a, b] = pair(20, 6, FEATURES);
    const values = ['Name', 'x', 'y', 'x', 'z'];
    for (const [row, value] of values.entries()) {
      await set(a, row, 1, value);
    }
    sync(a, b);
    await a.commands.executeCommand('sheet.mutation.set-filter-range', { unitId: UNIT, subUnitId: a.sheetId, range: cells(0, 4, 0, 2) });
    await a.commands.executeCommand('sheet.mutation.set-filter-criteria', {
      unitId: UNIT,
      subUnitId: a.sheetId,
      col: 1,
      criteria: { colId: 1, filters: { filters: ['x'] } },
    });
    expect([...filterModel(a)!.filteredOutRows].sort()).toEqual([2, 4]);
    const [stored] = readRules(readSheet(a.doc, a.sheetId)!, FILTER_FEATURE);
    expect(stored.id).toBe('filter:sheet');
    await insertColumn(b, 0);
    sync(a, b);
    expectConverged(a, b);
    for (const device of [a, b]) {
      const model = filterModel(device)!;
      expect(bare(model.getRange())).toEqual(cells(0, 4, 1, 3));
      expect(model.serialize().filterColumns).toEqual([{ colId: 2, filters: { filters: ['x'] } }]);
      expect([...model.filteredOutRows].sort()).toEqual([2, 4]);
    }
  });

  it('removes the filter on both devices', async () => {
    const [a, b] = pair(20, 6, FEATURES);
    await a.commands.executeCommand('sheet.mutation.set-filter-range', { unitId: UNIT, subUnitId: a.sheetId, range: cells(0, 4, 0, 2) });
    sync(a, b);
    expect(filterModel(b)).not.toBeNull();
    await b.commands.executeCommand('sheet.mutation.remove-filter', { unitId: UNIT, subUnitId: b.sheetId });
    sync(a, b);
    expect(filterModel(a)).toBeNull();
    expect(readRules(readSheet(a.doc, a.sheetId)!, FILTER_FEATURE)).toEqual([]);
  });
});

describe('opening a spreadsheet', () => {
  it('loads every feature from the CRDT into a fresh Univer', async () => {
    const [a] = pair(20, 6, FEATURES);
    await addFormulaRule(a, 'cf1', cells(0, 4, 0), '=A1>1');
    await a.commands.executeCommand('data-validation.mutation.addRule', {
      unitId: UNIT,
      subUnitId: a.sheetId,
      rule: { uid: 'dv1', type: 'list', ranges: [cells(0, 2, 1)], formula1: 'x,y' },
    });
    await a.commands.executeCommand('sheet.mutation.set-filter-range', { unitId: UNIT, subUnitId: a.sheetId, range: cells(0, 4, 0, 2) });
    const reopened = device(a.doc, FEATURES);
    expect(conditionalRules(reopened).map((rule) => rule.cfId)).toEqual(['cf1']);
    expect(validationRules(reopened).map((rule) => rule.uid)).toEqual(['dv1']);
    expect(bare(filterModel(reopened)!.getRange())).toEqual(cells(0, 4, 0, 2));
    expect(reopened.binding.unbound.size).toBe(0);
  });
});

describe('features the binding carries', () => {
  it('are no longer counted as unbound', async () => {
    const [a] = pair(20, 6, FEATURES);
    await addFormulaRule(a, 'cf1', cells(0, 4, 0), '=A1>1');
    await a.commands.executeCommand('sheet.mutation.set-filter-range', { unitId: UNIT, subUnitId: a.sheetId, range: cells(0, 4, 0, 2) });
    expect([...a.binding.unbound.keys()]).toEqual([]);
    expect(readRules(readSheet(a.doc, a.sheetId)!, VALIDATION_FEATURE)).toEqual([]);
  });
});
