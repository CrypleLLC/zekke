import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Direction } from '@univerjs/core';
import { InsertRowCommand, SetRangeValuesCommand } from '@univerjs/sheets';
import type { LocaleType } from '@univerjs/core';
import { DocumentSync, MAX_SNAPSHOT_CHARACTERS, sealUpdate } from '@/lib/documents';
import {
  FORMULA_CODEC,
  SNAPSHOT_RAW_BYTES_LIMIT,
  SPREADSHEET_SYNC_OPTIONS,
  fromWorkbookData,
  readSheets,
  type CapacityRefusal,
} from '@/lib/spreadsheets';
import { FakeDocumentServer, TEST_DOCUMENT_DEK } from '@/test/document-server';
import {
  UNIT,
  cellText,
  device,
  disposeDevices,
  pair,
  rowRange,
  univerView,
  type Device,
} from '@/test/spreadsheets';

afterEach(disposeDevices);

function block(rows: number, columns: number, value: (row: number, column: number) => unknown) {
  return Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => ({ v: value(row, column) })));
}

async function paste(target: Device, startRow: number, rows: number, columns: number, offset = 0): Promise<boolean> {
  return target.commands.executeCommand(SetRangeValuesCommand.id, {
    unitId: UNIT,
    subUnitId: target.sheetId,
    range: { startRow, endRow: startRow + rows - 1, startColumn: 0, endColumn: columns - 1 },
    value: block(rows, columns, (row, column) => offset + row * columns + column + 0.25),
  });
}

describe('the capacity guard', () => {
  it('refuses a paste that would pass the limit, before anything is written', async () => {
    const [a] = pair(3000, 6);
    const used = Y.encodeStateAsUpdate(a.doc).length;
    const refusals: CapacityRefusal[] = [];
    const guarded = device(a.doc, {
      capacityLimitBytes: used + 60_000,
      onCapacityRefused: (refusal) => refusals.push(refusal),
    });

    expect(await paste(guarded, 0, 200, 6)).toBe(true);
    expect(cellText(guarded, 199, 5)).toBe(199 * 6 + 5 + 0.25);

    const before = Y.encodeStateVector(a.doc);
    expect(await paste(guarded, 200, 2000, 6, 100_000)).toBe(false);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ reason: 'workbook-full' });
    expect(refusals[0].addedBytes).toBeGreaterThan(60_000 - (refusals[0].usedBytes - used));
    expect(cellText(guarded, 200, 0)).toBeUndefined();
    expect(Y.encodeStateVector(a.doc)).toEqual(before);
  });

  it('refuses one cell too large for a delta to carry', async () => {
    const [a] = pair();
    const refusals: CapacityRefusal[] = [];
    const guarded = device(a.doc, { onCapacityRefused: (refusal) => refusals.push(refusal) });
    const accepted = await guarded.commands.executeCommand(SetRangeValuesCommand.id, {
      unitId: UNIT,
      subUnitId: guarded.sheetId,
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      value: { v: 'x'.repeat(70 * 1024) },
    });
    expect(accepted).toBe(false);
    expect(refusals[0]).toMatchObject({ reason: 'cell-too-large' });
    expect(cellText(guarded, 0, 0)).toBeUndefined();
  });

  it('never refuses what arrives from another device', async () => {
    const [a, b] = pair(3000, 6);
    const limited = device(b.doc, { capacityLimitBytes: Y.encodeStateAsUpdate(b.doc).length + 1000 });
    await paste(a, 0, 500, 6);
    a.binding.settle();
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc)));
    limited.binding.settle();
    expect(cellText(limited, 499, 5)).toBe(499 * 6 + 5 + 0.25);
  });
});

describe('a spreadsheet at the capacity bound', () => {
  const ROWS = 7600;
  const COLUMNS = 26;
  const WORDS = ['Paid', 'Pending', 'São Paulo', 'Rent'];

  async function seededServer(): Promise<FakeDocumentServer> {
    const cellData: Record<number, Record<number, object>> = {};
    for (let row = 0; row < ROWS; row += 1) {
      cellData[row] = {};
      for (let column = 0; column < COLUMNS; column += 1) {
        cellData[row][column] =
          column % 4 === 2
            ? { v: WORDS[row % 4], t: 1 }
            : column % 4 === 3
              ? { v: 45000 + row, t: 2, s: 'date' }
              : { v: Math.round(row * column * 137) / 100, t: 2 };
      }
    }
    const doc = new Y.Doc();
    fromWorkbookData(
      doc,
      {
        id: UNIT,
        name: 'Book',
        appVersion: '1.0.3',
        locale: 'enUS' as LocaleType,
        styles: { date: { n: { pattern: 'yyyy-mm-dd' } } },
        sheetOrder: ['s'],
        sheets: { s: { id: 's', name: 'Sheet1', rowCount: ROWS, columnCount: COLUMNS, cellData } },
      },
      FORMULA_CODEC,
    );
    const server = new FakeDocumentServer();
    server.snapshotCiphertext = await sealUpdate(Y.encodeStateAsUpdate(doc), TEST_DOCUMENT_DEK);
    return server;
  }

  async function openDevice(server: FakeDocumentServer, onCapacityRefused?: (refusal: CapacityRefusal) => void) {
    const sync = new DocumentSync(server.id, server.transport(), {
      ...SPREADSHEET_SYNC_OPTIONS,
      debounceMs: 0,
      pollIntervalMs: 0,
    });
    await sync.open();
    return { sync, editor: device(sync.doc, { onCapacityRefused }) };
  }

  it('opens, edits, refuses what would not fit, compacts, and reopens the same on a second device', async () => {
    const server = await seededServer();
    expect(server.snapshotCiphertext.length).toBeGreaterThan(MAX_SNAPSHOT_CHARACTERS * 0.9);
    expect(server.snapshotCiphertext.length).toBeLessThan(MAX_SNAPSHOT_CHARACTERS);

    const refusals: CapacityRefusal[] = [];
    const first = await openDevice(server, (refusal) => refusals.push(refusal));
    expect(readSheets(first.sync.doc)[0].id).toBe('s');
    expect(first.editor.binding.capacity.usedBytes()).toBeLessThan(SNAPSHOT_RAW_BYTES_LIMIT);

    await first.editor.commands.executeCommand(InsertRowCommand.id, {
      unitId: UNIT,
      subUnitId: 's',
      range: rowRange(first.editor, 0),
      direction: Direction.UP,
    });
    await first.editor.commands.executeCommand(SetRangeValuesCommand.id, {
      unitId: UNIT,
      subUnitId: 's',
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
      value: [[{ v: 'Total' }, { f: '=SUM(B2:B100)' }]],
    });
    expect(await paste(first.editor, 1, 100, 6, 500)).toBe(true);
    expect(await paste(first.editor, 200, 4000, 26, 9000)).toBe(false);
    expect(refusals.map((refusal) => refusal.reason)).toEqual(['workbook-full']);

    first.editor.binding.settle();
    await first.sync.flush();
    await first.sync.compact();
    expect(server.compactions).toHaveLength(1);
    expect(server.compactions[0]).toBeLessThanOrEqual(MAX_SNAPSHOT_CHARACTERS);
    expect(first.sync.getState().capacity).not.toBe('over');

    const second = await openDevice(server);
    expect(univerView(second.editor)).toBe(univerView(first.editor));
    expect(cellText(second.editor, 0, 1)).toBe('=SUM(B2:B100)');

    first.sync.destroy();
    second.sync.destroy();
  }, 120_000);
});
