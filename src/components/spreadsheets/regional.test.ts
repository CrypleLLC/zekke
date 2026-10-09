import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  ICommandService,
  IUniverInstanceService,
  LocaleType,
  LogLevel,
  RegionService,
  Univer,
  UniverInstanceType,
  getNumfmtParseValueFilter,
  type ICellData,
  type Nullable,
  type Workbook,
} from '@univerjs/core';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { BEFORE_CELL_EDIT, SetRangeValuesCommand, SheetInterceptorService, UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsNumfmtPlugin, getCurrencyFormat } from '@univerjs/sheets-numfmt';
import sheetsEn from '@univerjs/sheets/locale/en-US';
import { spreadsheetCountryDefaults } from '@/lib/regional';
import { FORMULA_CODEC, functionNames, newSpreadsheetDoc, toWorkbookData } from '@/lib/spreadsheets';
import { applyRegionalSyntax, numfmtLocaleFor } from './regional';

const UNIT = 'unit';
const sheetDefaults = (country: string) => spreadsheetCountryDefaults(country, 'en');
const NAMES = functionNames({ SUM: 'SOMA', IF: 'SE', TRUE: 'VERDADEIRO', FALSE: 'FALSO' });
const started: Univer[] = [];

afterEach(() => {
  for (const univer of started.splice(0)) {
    univer.dispose();
  }
});

function start(): { univer: Univer; workbook: Workbook; sheetId: string; commands: ICommandService } {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(newSpreadsheetDoc()));
  const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: { ...sheetsEn } }, logLevel: LogLevel.SILENT });
  univer.registerPlugin(UniverFormulaEnginePlugin, { notExecuteFormula: true });
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsNumfmtPlugin);
  univer.createUnit(
    UniverInstanceType.UNIVER_SHEET,
    toWorkbookData(doc, { unitId: UNIT, name: 'Book', locale: LocaleType.EN_US, appVersion: '1.0.3' }, FORMULA_CODEC),
  );
  started.push(univer);
  const injector = univer.__getInjector();
  const workbook = injector.get(IUniverInstanceService).getUnit<Workbook>(UNIT, UniverInstanceType.UNIVER_SHEET)!;
  return { univer, workbook, sheetId: workbook.getActiveSheet().getSheetId(), commands: injector.get(ICommandService) };
}

async function put(commands: ICommandService, sheetId: string, row: number, value: ICellData) {
  await commands.executeCommand(SetRangeValuesCommand.id, {
    unitId: UNIT,
    subUnitId: sheetId,
    range: { startRow: row, endRow: row, startColumn: 0, endColumn: 0 },
    value,
  });
}

function editorCell(univer: Univer, workbook: Workbook, row: number): Nullable<ICellData> {
  const worksheet = workbook.getActiveSheet();
  const interceptors = univer.__getInjector().get(SheetInterceptorService);
  return interceptors.writeCellInterceptor.fetchThroughInterceptors(BEFORE_CELL_EDIT)(worksheet.getCell(row, 0), {
    workbook,
    worksheet,
    unitId: UNIT,
    subUnitId: worksheet.getSheetId(),
    row,
    col: 0,
    origin: worksheet.getCellRaw(row, 0),
  } as never);
}

function committed(univer: Univer, workbook: Workbook, cell: ICellData): Nullable<ICellData> {
  const worksheet = workbook.getActiveSheet();
  return univer.__getInjector().get(SheetInterceptorService).onWriteCell(workbook, worksheet, 0, 0, cell);
}

describe('Univer’s number locale', () => {
  it.each([
    ['BR', 'pt-BR'],
    ['US', 'en-US'],
    ['DE', 'de-DE'],
    ['CH', 'de-CH'],
    ['FR', 'fr-FR'],
    ['GB', 'en-GB'],
  ])('is the country’s own when it writes numbers the same way: %s', (country, locale) => {
    expect(numfmtLocaleFor(sheetDefaults(country))).toBe(locale);
  });

  it('follows the separators and the date order the person chose, over the country', () => {
    const brazilian = sheetDefaults('BR');
    expect(numfmtLocaleFor({ ...brazilian, number: 'comma-dot' })).toBe('en-GB');
    expect(numfmtLocaleFor({ ...sheetDefaults('US'), number: 'dot-comma', date: 'dd/mm/yyyy' })).toBe('pt-BR');
  });
});

describe('the editor in the person’s syntax', () => {
  it('shows a stored number with a decimal comma, which Univer then reads back as the same number', async () => {
    const { univer, workbook, sheetId, commands } = start();
    applyRegionalSyntax(univer, sheetDefaults('BR'), NAMES);
    await put(commands, sheetId, 0, { v: 3.5 });
    await put(commands, sheetId, 1, { v: 1234.125 });

    expect(editorCell(univer, workbook, 0)?.v).toBe('3,5');
    expect(editorCell(univer, workbook, 1)?.v).toBe('1234,125');
    expect(getNumfmtParseValueFilter('3,5', { locale: numfmtLocaleFor(sheetDefaults('BR')) as never })?.v).toBe(3.5);
    expect(getNumfmtParseValueFilter('1234,125', { locale: numfmtLocaleFor(sheetDefaults('BR')) as never })?.v).toBe(1234.125);
  });

  it('draws a general number with a decimal comma, and a number with a format as the locale writes it', async () => {
    const { univer, workbook, sheetId, commands } = start();
    applyRegionalSyntax(univer, sheetDefaults('BR'), NAMES);
    await put(commands, sheetId, 0, { v: 3.5 });
    await put(commands, sheetId, 1, { v: 1234567.891, s: { n: { pattern: '#,##0.00' } } });

    expect(workbook.getActiveSheet().getCell(0, 0)?.v).toBe('3,5');
    expect(workbook.getActiveSheet().getCell(1, 0)?.v).toBe('1.234.567,89');
  });

  it('shows a formula in the person’s language and commits it in Univer’s', async () => {
    const { univer, workbook, sheetId, commands } = start();
    applyRegionalSyntax(univer, sheetDefaults('BR'), NAMES);
    await put(commands, sheetId, 0, { f: '=IF(A2>1.5,SUM(A2:A3),FALSE)' });

    expect(editorCell(univer, workbook, 0)?.f).toBe('=SE(A2>1,5;SOMA(A2:A3);FALSO)');
    expect(committed(univer, workbook, { f: '=se(A2>1,5;soma(A2:A3);falso)' })?.f).toBe('=IF(A2>1.5,SUM(A2:A3),FALSE)');
  });

  it('leaves everything as it was for someone who writes numbers the canonical way', async () => {
    const { univer, workbook, sheetId, commands } = start();
    applyRegionalSyntax(univer, sheetDefaults('US'));
    await put(commands, sheetId, 0, { v: 3.5 });
    await put(commands, sheetId, 1, { f: '=SUM(A1,1.5)' });

    expect(workbook.getActiveSheet().getCell(0, 0)?.v).toBe(3.5);
    expect(editorCell(univer, workbook, 0)?.v).toBe(3.5);
    expect(editorCell(univer, workbook, 1)?.f).toBe('=SUM(A1,1.5)');
  });

  it('makes Univer’s currency format use the preferred currency, written as the country writes it', () => {
    const { univer } = start();
    applyRegionalSyntax(univer, { ...sheetDefaults('BR'), currency: 'EUR' });
    const region = univer.__getInjector().get(RegionService).getCurrentRegion();
    expect(getCurrencyFormat(region as never)).toContain('"€"');
  });

  it('stops translating once disposed', async () => {
    const { univer, workbook, sheetId, commands } = start();
    const stop = applyRegionalSyntax(univer, sheetDefaults('BR'), NAMES);
    await put(commands, sheetId, 0, { f: '=SUM(1.5)' });
    stop();
    expect(editorCell(univer, workbook, 0)?.f).toBe('=SUM(1.5)');
    expect(committed(univer, workbook, { f: '=SOMA(1;2)' })?.f).toBe('=SOMA(1;2)');
  });
});
