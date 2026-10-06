import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Direction } from '@univerjs/core';
import {
  AddWorksheetMergeCommand,
  InsertColCommand,
  InsertRowCommand,
  MoveRowsCommand,
  RemoveColCommand,
  RemoveRowCommand,
  SetRangeValuesCommand,
} from '@univerjs/sheets';
import {
  DEFAULT_CHART_SETTINGS,
  FORMULA_CODEC,
  insertLines,
  readCharts,
  readNames,
  readSheet,
  removeRule,
  styleId,
  writeChart,
  type CapacityRefusal,
} from '@/lib/spreadsheets';
import { CAPTURE_ORIGIN } from './binding';
import {
  UNIT,
  calculation,
  cellText,
  cellValue,
  device,
  disposeDevices,
  expectConverged,
  pair,
  rowRange,
  set,
  sync,
  workbookOf,
} from '@/test/spreadsheets';
import { MutationCapture } from './capture';
import { WorkbookMirror, planAxis, planOrder } from './mirror';
import { UniverSurface } from './surface';

afterEach(disposeDevices);

describe('planning an axis', () => {
  it.each([
    [['a', 'b', 'c'], ['a', 'b', 'c']],
    [['a', 'b', 'c'], ['a', 'c']],
    [['a', 'c'], ['a', 'b', 'c']],
    [['a', 'b', 'c', 'd'], ['d', 'a', 'b', 'c']],
    [['a', 'b', 'c'], ['x', 'c', 'b', 'y']],
  ])('turns %j into %j', (current, target) => {
    const working = [...current];
    for (const step of planAxis(current, target)) {
      if (step.action === 'remove') {
        working.splice(step.index, 1);
      } else {
        working.splice(step.index, 0, step.id);
      }
    }
    expect(working).toEqual(target);
  });

  it('removes only what moved, not the lines that kept their order', () => {
    const steps = planAxis(['a', 'b', 'c', 'd'], ['d', 'a', 'b', 'c']);
    expect(steps.filter((step) => step.action === 'remove')).toHaveLength(1);
  });

  it('orders sheets with moves', () => {
    const working = ['a', 'b', 'c'];
    for (const step of planOrder(working, ['c', 'a', 'b'])) {
      working.splice(step.from, 1);
      working.splice(step.to, 0, step.id);
    }
    expect(working).toEqual(['c', 'a', 'b']);
  });
});

describe('the binding, with two devices editing offline and then syncing', () => {
  it('1. keeps both rows when both insert above the same cell and type into them', async () => {
    const [a, b] = pair();
    await set(a, 0, 0, 'top');
    await set(a, 1, 0, 'bottom');
    sync(a, b);
    await a.commands.executeCommand(InsertRowCommand.id, { unitId: UNIT, subUnitId: a.sheetId, range: rowRange(a, 1), direction: Direction.UP });
    await b.commands.executeCommand(InsertRowCommand.id, { unitId: UNIT, subUnitId: b.sheetId, range: rowRange(b, 1), direction: Direction.UP });
    await set(a, 1, 0, 'from A');
    await set(b, 1, 0, 'from B');
    sync(a, b);
    const view = expectConverged(a, b);
    expect(view).toContain('0,0=top');
    expect(view).toContain('3,0=bottom');
    expect([cellText(a, 1, 0), cellText(a, 2, 0)].sort()).toEqual(['from A', 'from B']);
  });

  it('2. grows a formula over a range the other device inserted a row into', async () => {
    const [a, b] = pair();
    await set(a, 0, 0, 1);
    await set(a, 1, 0, 2);
    await set(a, 2, 0, 3);
    sync(a, b);
    await set(a, 4, 0, '=SUM(A1:A3)');
    await b.commands.executeCommand(InsertRowCommand.id, { unitId: UNIT, subUnitId: b.sheetId, range: rowRange(b, 1), direction: Direction.UP });
    await set(b, 1, 0, 10);
    sync(a, b);
    await calculation();
    expectConverged(a, b);
    for (const device of [a, b]) {
      expect(cellText(device, 5, 0)).toBe('=SUM(A1:A4)');
      expect(cellValue(device, 5, 0)).toBe(16);
    }
  });

  it('3. shows #REF! where a formula pointed at a column the other device deleted', async () => {
    const [a, b] = pair();
    await set(a, 0, 1, 21);
    sync(a, b);
    await set(a, 0, 2, '=B1*2');
    await set(a, 1, 2, '=SUM(A1:C1)');
    await b.commands.executeCommand(RemoveColCommand.id, {
      unitId: UNIT,
      subUnitId: b.sheetId,
      range: { startRow: 0, endRow: 19, startColumn: 1, endColumn: 1, rangeType: 2 },
    });
    sync(a, b);
    expectConverged(a, b);
    for (const device of [a, b]) {
      expect(cellText(device, 0, 1)).toBe('=#REF!*2');
      expect(cellText(device, 1, 1)).toBe('=SUM(A1:B1)');
    }
  });

  it('4. keeps a merge and the values the other device typed under and beside it', async () => {
    const [a, b] = pair();
    await set(a, 0, 0, 'title');
    sync(a, b);
    await a.commands.executeCommand(AddWorksheetMergeCommand.id, {
      unitId: UNIT,
      subUnitId: a.sheetId,
      selections: [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 }],
    });
    await set(b, 1, 1, 'under the merge');
    await set(b, 3, 3, 'outside');
    sync(a, b);
    const view = expectConverged(a, b);
    expect(view).toContain('merges 0-1/0-2');
    expect(view).toContain('1,1=under the merge');
  });

  it('5. converges when one removes rows and the other inserts a column, edits a removed row and moves a row', async () => {
    const [a, b] = pair();
    for (let row = 0; row < 6; row += 1) {
      await set(a, row, 0, `r${row}`);
    }
    sync(a, b);
    await a.commands.executeCommand(RemoveRowCommand.id, { unitId: UNIT, subUnitId: a.sheetId, range: rowRange(a, 2, 3) });
    await b.commands.executeCommand(InsertColCommand.id, {
      unitId: UNIT,
      subUnitId: b.sheetId,
      range: { startRow: 0, endRow: 19, startColumn: 0, endColumn: 0, rangeType: 2 },
      direction: Direction.LEFT,
    });
    await set(b, 3, 1, 'r3 edited');
    const moved = rowRange(b, 5);
    await b.commands.executeCommand(MoveRowsCommand.id, { unitId: UNIT, subUnitId: b.sheetId, range: moved, fromRange: moved, toRange: rowRange(b, 0) });
    sync(a, b);
    expectConverged(a, b);
    expect([0, 1, 2, 3].map((row) => cellText(a, row, 1))).toEqual(['r5', 'r0', 'r1', 'r4']);
  });

  it('6. carries a paste of 10 000 cells', async () => {
    const [a, b] = pair(20, 6);
    await a.commands.executeCommand('sheet.command.set-worksheet-row-count', { unitId: UNIT, subUnitId: a.sheetId, rowCount: 1700 });
    const value = Array.from({ length: 1667 }, (_, row) => Array.from({ length: 6 }, (_, column) => ({ v: row * 6 + column + 0.5 })));
    await a.commands.executeCommand(SetRangeValuesCommand.id, {
      unitId: UNIT,
      subUnitId: a.sheetId,
      range: { startRow: 0, endRow: 1666, startColumn: 0, endColumn: 5 },
      value,
    });
    sync(a, b);
    expectConverged(a, b);
    expect(cellValue(b, 1666, 5)).toBe(1666 * 6 + 5 + 0.5);
  });

  it('7. keeps one value, the same on both, when both type into one cell', async () => {
    const [a, b] = pair();
    await set(a, 2, 2, 'from A');
    await set(b, 2, 2, 'from B');
    sync(a, b);
    expectConverged(a, b);
  });

  it('8. keeps a bold set on one device and a value typed on the other into the same cell', async () => {
    const [a, b] = pair();
    await set(a, 1, 1, 'plain');
    sync(a, b);
    await set(a, 1, 1, { s: { bl: 1 } });
    await set(b, 1, 1, 'edited');
    sync(a, b);
    const view = expectConverged(a, b);
    expect(view).toContain(`1,1=edited#${styleId({ bl: 1 })}`);
  });

  it('9. moves a value typed into a row the other device moved', async () => {
    const [a, b] = pair();
    for (let row = 0; row < 4; row += 1) {
      await set(a, row, 0, `r${row}`);
    }
    sync(a, b);
    const moved = rowRange(a, 3);
    await a.commands.executeCommand(MoveRowsCommand.id, { unitId: UNIT, subUnitId: a.sheetId, range: moved, fromRange: moved, toRange: rowRange(a, 0) });
    await set(b, 3, 1, 'typed beside r3');
    sync(a, b);
    expectConverged(a, b);
    expect([cellText(a, 0, 0), cellText(a, 0, 1)]).toEqual(['r3', 'typed beside r3']);
  });
});

describe('what the binding writes', () => {
  it('writes one transaction per command, and nothing when it applies a remote change', async () => {
    const [a, b] = pair();
    const origins: unknown[] = [];
    b.doc.on('afterTransaction', (transaction: Y.Transaction) => origins.push(transaction.origin));
    await b.commands.executeCommand(InsertRowCommand.id, { unitId: UNIT, subUnitId: b.sheetId, range: rowRange(b, 1), direction: Direction.UP });
    expect(origins.filter((origin) => origin === CAPTURE_ORIGIN)).toHaveLength(1);
    origins.length = 0;
    await set(a, 0, 0, 'remote');
    sync(a, b);
    expect(origins.filter((origin) => origin === CAPTURE_ORIGIN)).toHaveLength(0);
    expectConverged(a, b);
  });

  it('leaves both state vectors equal once synced, so neither device echoes the other', async () => {
    const [a, b] = pair();
    await set(a, 0, 0, 'x');
    await b.commands.executeCommand(InsertRowCommand.id, { unitId: UNIT, subUnitId: b.sheetId, range: rowRange(b, 0), direction: Direction.UP });
    sync(a, b);
    sync(a, b);
    expect(Y.encodeStateVector(a.doc)).toEqual(Y.encodeStateVector(b.doc));
  });

  it('counts a mutation it does not bind', () => {
    const [a] = pair();
    const capture = new MutationCapture({
      surface: new UniverSurface(a.univer, UNIT),
      mirror: WorkbookMirror.fromDoc(a.doc),
      codec: FORMULA_CODEC,
      knownIds: () => new Set(),
    });
    expect(capture.capture('sheet.mutation.something-new', {})).toEqual({ unbound: true });
    expect(capture.capture('sheet.mutation.empty', {})).toEqual({ ignored: true });
    expect(capture.capture('doc.mutation.rich-text-editing', { unitId: 'cell-editor' })).toEqual({ ignored: true });
  });

  it('stores a filled-down shared formula as one formula per cell', async () => {
    const [a, b] = pair();
    await a.commands.executeCommand(SetRangeValuesCommand.id, {
      unitId: UNIT,
      subUnitId: a.sheetId,
      range: { startRow: 0, endRow: 2, startColumn: 1, endColumn: 1 },
      value: [[{ f: '=A1*2', si: 'shared' }], [{ si: 'shared' }], [{ si: 'shared' }]],
    });
    sync(a, b);
    for (const row of [0, 1, 2]) {
      expect(cellText(b, row, 1)).toBe(`=A${row + 1}*2`);
    }
  });
});

describe('undo and redo', () => {
  it('undo reverts only this device’s edit, never the other device’s', async () => {
    const [a, b] = pair();
    await set(a, 0, 0, 'mine');
    await set(b, 0, 1, 'theirs');
    sync(a, b);
    a.binding.undo();
    sync(a, b);
    expectConverged(a, b);
    expect(cellText(a, 0, 0)).toBeUndefined();
    expect(cellText(a, 0, 1)).toBe('theirs');
    a.binding.redo();
    sync(a, b);
    expectConverged(a, b);
    expect(cellText(b, 0, 0)).toBe('mine');
  });

  it('undoes one command at a time', async () => {
    const [a] = pair();
    await set(a, 0, 0, 'first');
    await set(a, 1, 0, 'second');
    a.binding.undo();
    a.binding.settle();
    expect(cellText(a, 0, 0)).toBe('first');
    expect(cellText(a, 1, 0)).toBeUndefined();
  });

  it('brings back a removed row with its values', async () => {
    const [a, b] = pair();
    for (let row = 0; row < 3; row += 1) {
      await set(a, row, 0, `r${row}`);
    }
    sync(a, b);
    await a.commands.executeCommand(RemoveRowCommand.id, { unitId: UNIT, subUnitId: a.sheetId, range: rowRange(a, 1) });
    a.binding.undo();
    sync(a, b);
    expectConverged(a, b);
    expect([0, 1, 2].map((row) => cellText(b, row, 0))).toEqual(['r0', 'r1', 'r2']);
  });

  it('runs through Univer’s own undo command, and leaves Univer’s stack empty', async () => {
    const [a] = pair();
    await set(a, 0, 0, 'typed');
    await a.commands.executeCommand('univer.command.undo');
    a.binding.settle();
    expect(cellText(a, 0, 0)).toBeUndefined();
    await a.commands.executeCommand('univer.command.redo');
    a.binding.settle();
    expect(cellText(a, 0, 0)).toBe('typed');
  });
});

describe('sheets, lines and names', () => {
  it('carries sizes, hidden lines and the freeze', async () => {
    const [a, b] = pair();
    await a.commands.executeCommand('sheet.command.set-row-height', {
      unitId: UNIT,
      subUnitId: a.sheetId,
      ranges: [{ startRow: 2, endRow: 3, startColumn: 0, endColumn: 5 }],
      value: 40,
    });
    await a.commands.executeCommand('sheet.command.set-worksheet-col-width', {
      unitId: UNIT,
      subUnitId: a.sheetId,
      ranges: [{ startRow: 0, endRow: 19, startColumn: 1, endColumn: 1 }],
      value: 150,
    });
    await a.commands.executeCommand('sheet.command.set-rows-hidden', {
      unitId: UNIT,
      subUnitId: a.sheetId,
      ranges: [{ startRow: 5, endRow: 5, startColumn: 0, endColumn: 5, rangeType: 1 }],
    });
    await a.commands.executeCommand('sheet.command.set-frozen', {
      unitId: UNIT,
      subUnitId: a.sheetId,
      startRow: 1,
      startColumn: 1,
      xSplit: 1,
      ySplit: 1,
    });
    sync(a, b);
    const view = expectConverged(a, b);
    expect(view).toContain('freeze 1,1');
    expect(view).toContain('r2:40');
    expect(view).toContain('c1:150');
    expect(view).toContain('r5:h');
  });

  it('carries a new sheet, its rename, its order and its removal, and formulas follow the name', async () => {
    const [a, b] = pair();
    await a.commands.executeCommand('sheet.command.insert-sheet', {
      unitId: UNIT,
      index: 1,
      sheet: { id: 'second', name: 'Second', rowCount: 10, columnCount: 4, cellData: { 0: { 0: { v: 7 } } } },
    });
    sync(a, b);
    await set(b, 0, 0, '=Second!A1*2');
    sync(a, b);
    await a.commands.executeCommand('sheet.command.set-worksheet-name', { unitId: UNIT, subUnitId: 'second', name: 'Renamed' });
    await a.commands.executeCommand('sheet.command.set-worksheet-order', { unitId: UNIT, subUnitId: 'second', order: 0 });
    sync(a, b);
    expectConverged(a, b);
    expect(workbookOf(b).getSheetOrders()[0]).toBe('second');
    expect(cellText(b, 0, 0)).toBe('=Renamed!A1*2');
    await b.commands.executeCommand('sheet.command.remove-sheet', { unitId: UNIT, subUnitId: 'second' });
    sync(a, b);
    expectConverged(a, b);
    expect(workbookOf(a).getSheetOrders()).toEqual([a.sheetId]);
    expect(cellText(a, 0, 0)).toBe('=#REF!*2');
  });

  it('carries a defined name, which follows a row the other device inserted', async () => {
    const [a, b] = pair();
    await a.commands.executeCommand('sheet.command.insert-defined-name', {
      unitId: UNIT,
      id: 'total',
      name: 'Total',
      formulaOrRefString: 'Sheet1!$B$2',
    });
    sync(a, b);
    expect(readNames(b.doc).get('total')?.name).toBe('Total');
    await b.commands.executeCommand(InsertRowCommand.id, { unitId: UNIT, subUnitId: b.sheetId, range: rowRange(b, 0), direction: Direction.UP });
    sync(a, b);
    for (const device of [a, b]) {
      const name = new UniverSurface(device.univer, UNIT).definedName('total');
      expect(name?.formulaOrRefString).toBe('Sheet1!$B$3');
    }
  });
});

describe('charts', () => {
  const CHART = {
    settings: DEFAULT_CHART_SETTINGS,
    source: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 },
    anchor: {
      from: { row: 0, column: 3, rowOffset: 0, columnOffset: 0 },
      to: { row: 10, column: 5, rowOffset: 0, columnOffset: 0 },
    },
  };

  function chartsOf(doc: Y.Doc, sheetId: string) {
    return readCharts(readSheet(doc, sheetId)!);
  }

  it('writes a chart as its own undo step, kept out of Univer', async () => {
    const [a, b] = pair();
    await set(a, 0, 0, 'before');
    expect(a.binding.editSheet(a.sheetId, 400, (sheet) => writeChart(sheet, 'c1', CHART))).toBe(true);
    sync(a, b);
    expect(chartsOf(b.doc, b.sheetId).map((chart) => chart.id)).toEqual(['c1']);
    expect(a.binding.unbound.size).toBe(0);
    expectConverged(a, b);

    a.binding.undo();
    sync(a, b);
    expect(chartsOf(b.doc, b.sheetId)).toEqual([]);
    expect(cellText(a, 0, 0)).toBe('before');

    a.binding.redo();
    sync(a, b);
    expect(chartsOf(b.doc, b.sheetId).map((chart) => chart.id)).toEqual(['c1']);
  });

  it('follows its data when the other device inserts rows, and goes when it is removed', async () => {
    const [a, b] = pair();
    a.binding.editSheet(a.sheetId, 400, (sheet) => writeChart(sheet, 'c1', CHART));
    sync(a, b);
    insertLines(readSheet(b.doc, b.sheetId)!, 'rows', 0, 2, 'remote');
    sync(a, b);
    expect(chartsOf(a.doc, a.sheetId)[0].source).toMatchObject({ startRow: 2, endRow: 5 });
    expect(chartsOf(a.doc, a.sheetId)[0].anchor.from.row).toBe(2);

    b.binding.editSheet(b.sheetId, 0, (sheet) => removeRule(sheet, 'c1'));
    sync(a, b);
    expect(chartsOf(a.doc, a.sheetId)).toEqual([]);
  });

  it('is refused past the capacity, and nothing is written', () => {
    const refusals: CapacityRefusal[] = [];
    const [a] = pair();
    const limited = device(a.doc, {
      capacityLimitBytes: Y.encodeStateAsUpdate(a.doc).length + 10,
      onCapacityRefused: (refusal) => refusals.push(refusal),
    });
    expect(limited.binding.editSheet(limited.sheetId, 400, (sheet) => writeChart(sheet, 'c1', CHART))).toBe(false);
    expect(refusals).toHaveLength(1);
    expect(chartsOf(a.doc, limited.sheetId)).toEqual([]);
  });

  it('refuses an edit to a sheet that no longer exists', () => {
    const [a] = pair();
    expect(a.binding.editSheet('missing', 0, () => undefined)).toBe(false);
  });
});
