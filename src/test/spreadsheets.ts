import { expect } from 'vitest';
import * as Y from 'yjs';
import {
  ICommandService,
  IUniverInstanceService,
  LocaleType,
  LogLevel,
  Univer,
  UniverInstanceType,
  type ICellData,
  type Workbook,
} from '@univerjs/core';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { SetRangeValuesCommand, UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import sheetsEn from '@univerjs/sheets/locale/en-US';
import {
  FORMULA_CODEC,
  createSheet,
  markSpreadsheet,
  readSheets,
  styleId,
  toWorkbookData,
  type StyleData,
} from '@/lib/spreadsheets';
import { SpreadsheetBinding, type SpreadsheetBindingOptions } from '@/components/spreadsheets/binding';

export const UNIT = 'unit';
export const IDENTITY = { unitId: UNIT, name: 'Book', locale: LocaleType.EN_US, appVersion: '1.0.3' };

export interface Device {
  doc: Y.Doc;
  univer: Univer;
  commands: ICommandService;
  binding: SpreadsheetBinding;
  sheetId: string;
}

const devices: Device[] = [];

export function disposeDevices(): void {
  for (const device of devices.splice(0)) {
    device.binding.dispose();
    device.univer.dispose();
  }
}

export function startUniver(doc: Y.Doc): Univer {
  const univer = new Univer({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: { ...sheetsEn } },
    logLevel: LogLevel.SILENT,
  });
  univer.registerPlugin(UniverFormulaEnginePlugin, { notExecuteFormula: false });
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin);
  univer.createUnit(UniverInstanceType.UNIVER_SHEET, toWorkbookData(doc, IDENTITY, FORMULA_CODEC));
  return univer;
}

export function device(doc: Y.Doc, options: Partial<SpreadsheetBindingOptions> = {}): Device {
  const univer = startUniver(doc);
  const binding = new SpreadsheetBinding({ univer, unitId: UNIT, doc, ...options });
  const created: Device = {
    doc,
    univer,
    commands: univer.__getInjector().get(ICommandService),
    binding,
    sheetId: readSheets(doc)[0].id,
  };
  devices.push(created);
  return created;
}

export function pair(rows = 20, columns = 6): [Device, Device] {
  const seed = new Y.Doc();
  markSpreadsheet(seed);
  createSheet(seed, { name: 'Sheet1', rows, columns });
  const update = Y.encodeStateAsUpdate(seed);
  const first = new Y.Doc();
  const second = new Y.Doc();
  Y.applyUpdate(first, update);
  Y.applyUpdate(second, update);
  return [device(first), device(second)];
}

export function sync(...devicesToSync: Device[]): void {
  for (const device of devicesToSync) {
    device.binding.settle();
  }
  for (const target of devicesToSync) {
    for (const source of devicesToSync) {
      if (source !== target) {
        Y.applyUpdate(target.doc, Y.encodeStateAsUpdate(source.doc, Y.encodeStateVector(target.doc)), 'remote');
      }
    }
  }
  for (const device of devicesToSync) {
    device.binding.settle();
  }
}

export const calculation = () => new Promise((resolve) => setTimeout(resolve, 250));

export function workbookOf(device: Device): Workbook {
  return device.univer
    .__getInjector()
    .get(IUniverInstanceService)
    .getUnit<Workbook>(UNIT, UniverInstanceType.UNIVER_SHEET)!;
}

export async function set(device: Device, row: number, column: number, value: unknown, sheetId = device.sheetId): Promise<void> {
  await device.commands.executeCommand(SetRangeValuesCommand.id, {
    unitId: UNIT,
    subUnitId: sheetId,
    range: { startRow: row, endRow: row, startColumn: column, endColumn: column },
    value: typeof value === 'string' && value.startsWith('=') ? { f: value } : typeof value === 'object' ? value : { v: value },
  });
}

export function rowRange(device: Device, start: number, end = start) {
  return { startRow: start, endRow: end, startColumn: 0, endColumn: columnCount(device) - 1, rangeType: 1 };
}

export function columnCount(device: Device): number {
  return workbookOf(device).getSheetBySheetId(device.sheetId)!.getColumnCount();
}

export function styleOf(workbook: Workbook, style: unknown): string {
  const resolved = typeof style === 'string' ? workbook.getStyles().get(style) : style;
  return resolved && Object.keys(resolved).length > 0 ? styleId(JSON.parse(JSON.stringify(resolved)) as StyleData) : '';
}

export function univerView(device: Device): string {
  const workbook = workbookOf(device);
  return workbook
    .getSheetOrders()
    .map((sheetId) => {
      const sheet = workbook.getSheetBySheetId(sheetId)!;
      const cells: string[] = [];
      sheet.getCellMatrix().forValue((row, column, value) => {
        const cell: ICellData = value ?? {};
        const shown = cell.f ? cell.f : cell.v === null || cell.v === undefined ? '' : String(cell.v);
        const style = styleOf(workbook, cell.s);
        if (shown !== '' || style !== '') {
          cells.push(`${row},${column}=${shown}${style ? `#${style}` : ''}`);
        }
      });
      const lines: string[] = [];
      for (let row = 0; row < sheet.getRowCount(); row += 1) {
        const data = sheet.getRowManager().getRow(row);
        if (typeof data?.h === 'number' || data?.hd === 1) {
          lines.push(`r${row}:${data?.h ?? ''}${data?.hd === 1 ? 'h' : ''}`);
        }
      }
      for (let column = 0; column < sheet.getColumnCount(); column += 1) {
        const data = sheet.getColumnManager().getColumn(column);
        if (typeof data?.w === 'number' || data?.hd === 1) {
          lines.push(`c${column}:${data?.w ?? ''}${data?.hd === 1 ? 'h' : ''}`);
        }
      }
      const merges = sheet
        .getMergeData()
        .map((range) => `${range.startRow}-${range.endRow}/${range.startColumn}-${range.endColumn}`)
        .sort();
      const freeze = sheet.getConfig().freeze;
      return [
        `${sheetId}:${sheet.getName()} ${sheet.getRowCount()}x${sheet.getColumnCount()}`,
        `freeze ${freeze && (freeze.xSplit || freeze.ySplit) ? `${freeze.xSplit},${freeze.ySplit}` : ''}`,
        `merges ${merges.join(' ')}`,
        `lines ${lines.sort().join(' ')}`,
        ...cells.sort(),
      ].join('\n');
    })
    .join('\n---\n');
}

export function crdtView(device: Device): string {
  const data = toWorkbookData(device.doc, IDENTITY, FORMULA_CODEC);
  return data.sheetOrder
    .map((sheetId) => {
      const sheet = data.sheets[sheetId]!;
      const cells: string[] = [];
      for (const [row, columns] of Object.entries(sheet.cellData ?? {})) {
        for (const [column, value] of Object.entries(columns)) {
          const cell = value as ICellData;
          const shown = cell.f ? cell.f : cell.v === null || cell.v === undefined ? '' : String(cell.v);
          const style = typeof cell.s === 'string' && data.styles[cell.s] ? styleId(data.styles[cell.s] as StyleData) : '';
          if (shown !== '' || style !== '') {
            cells.push(`${row},${column}=${shown}${style ? `#${style}` : ''}`);
          }
        }
      }
      const lines: string[] = [];
      for (const [row, value] of Object.entries(sheet.rowData ?? {})) {
        if (typeof value?.h === 'number' || value?.hd === 1) {
          lines.push(`r${row}:${value?.h ?? ''}${value?.hd === 1 ? 'h' : ''}`);
        }
      }
      for (const [column, value] of Object.entries(sheet.columnData ?? {})) {
        if (typeof value?.w === 'number' || value?.hd === 1) {
          lines.push(`c${column}:${value?.w ?? ''}${value?.hd === 1 ? 'h' : ''}`);
        }
      }
      const merges = (sheet.mergeData ?? [])
        .map((range) => `${range.startRow}-${range.endRow}/${range.startColumn}-${range.endColumn}`)
        .sort();
      const freeze = sheet.freeze;
      return [
        `${sheetId}:${sheet.name} ${sheet.rowCount}x${sheet.columnCount}`,
        `freeze ${freeze && (freeze.xSplit || freeze.ySplit) ? `${freeze.xSplit},${freeze.ySplit}` : ''}`,
        `merges ${merges.join(' ')}`,
        `lines ${lines.sort().join(' ')}`,
        ...cells.sort(),
      ].join('\n');
    })
    .join('\n---\n');
}

export function expectConverged(...all: Device[]): string {
  const views = all.map(univerView);
  for (const device of all) {
    expect(univerView(device)).toBe(crdtView(device));
  }
  for (const view of views) {
    expect(view).toBe(views[0]);
  }
  return views[0];
}

export function cellText(device: Device, row: number, column: number, sheetId = device.sheetId): unknown {
  const cell = workbookOf(device).getSheetBySheetId(sheetId)!.getCellRaw(row, column);
  return cell?.f ?? cell?.v;
}

export function cellValue(device: Device, row: number, column: number): unknown {
  return workbookOf(device).getSheetBySheetId(device.sheetId)!.getCellRaw(row, column)?.v;
}

