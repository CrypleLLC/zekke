import type { IWorkbookData, LocaleType } from '@univerjs/core';
import * as Y from 'yjs';
import { writeTitle } from '@/lib/documents/content';
import type { SpreadsheetRegional } from '@/lib/regional';
import { SNAPSHOT_RAW_BYTES_LIMIT, checkCapacity, estimateWorkbookBytes, type CapacityRefusal } from './capacity';
import { delimitedToWorkbookData, sheetToDelimited, type Delimiter } from './csv';
import { featureRulesOfWorkbook, writeFeatureRules } from './features';
import { FORMULA_CODEC } from './formulas';
import { readNames, writeName } from './names';
import { writeSheetRegional } from './sheet-regional';
import { readSheets } from './sheets';
import { WorkbookIndex, fromWorkbookData } from './workbook';
import { readXlsx, writeXlsx, type ExportedName, type InterchangeReport } from './xlsx';

export type SpreadsheetFormat = 'xlsx' | 'csv' | 'tsv';

export const IMPORT_ACCEPT = '.xlsx,.csv,.tsv,.txt';
export const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024;

const IMPORT_IDENTITY = { unitId: 'import', locale: 'enUS' as LocaleType, appVersion: '1.0.3' };

export class UnsupportedFormatError extends Error {
  constructor(readonly fileName: string) {
    super(`${fileName} is not an .xlsx, .csv or .tsv file`);
    this.name = 'UnsupportedFormatError';
  }
}

export class ImportTooLargeError extends Error {
  constructor(readonly refusal: CapacityRefusal) {
    super(`the file would take the spreadsheet past its capacity (${refusal.reason})`);
    this.name = 'ImportTooLargeError';
  }
}

export function formatOf(fileName: string): SpreadsheetFormat | undefined {
  const extension = fileName.toLowerCase().split('.').pop();
  if (extension === 'xlsx') {
    return 'xlsx';
  }
  if (extension === 'csv') {
    return 'csv';
  }
  if (extension === 'tsv' || extension === 'tab') {
    return 'tsv';
  }
  if (extension === 'txt') {
    return 'csv';
  }
  return undefined;
}

export function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^./\\]+$/, '').trim();
}

export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export interface ImportedSpreadsheet {
  snapshot: Uint8Array;
  report: InterchangeReport;
  sheets: number;
}

export async function importSpreadsheet(
  fileName: string,
  bytes: Uint8Array,
  regional?: SpreadsheetRegional,
): Promise<ImportedSpreadsheet> {
  const format = formatOf(fileName);
  if (format === undefined) {
    throw new UnsupportedFormatError(fileName);
  }
  if (bytes.length > MAX_IMPORT_FILE_BYTES) {
    throw new ImportTooLargeError({ reason: 'workbook-full', usedBytes: 0, addedBytes: bytes.length, limitBytes: MAX_IMPORT_FILE_BYTES });
  }
  const title = titleFromFileName(fileName);
  const identity = { ...IMPORT_IDENTITY, name: title };
  const imported =
    format === 'xlsx'
      ? await readXlsx(bytes, identity)
      : {
          workbook: delimitedToWorkbookData(decodeText(bytes), identity, format === 'tsv' ? '\t' : undefined),
          names: [],
          features: {},
          report: {},
        };

  const estimate = estimateWorkbookBytes(imported.workbook);
  const refusal = checkCapacity(0, estimate.bytes, estimate.largestCellBytes);
  if (refusal !== undefined) {
    throw new ImportTooLargeError(refusal);
  }

  const doc = new Y.Doc();
  try {
    fromWorkbookData(doc, imported.workbook, FORMULA_CODEC);
    writeTitle(doc, title);
    if (regional !== undefined) {
      writeSheetRegional(doc, regional);
    }
    const workbook = new WorkbookIndex(doc);
    const scope = workbook.sheetIds()[0];
    for (const [sheetId, rules] of Object.entries(imported.features)) {
      writeFeatureRules(doc, sheetId, rules, FORMULA_CODEC);
    }
    imported.names.forEach((name, index) => {
      writeName(doc, `imported-${index}`, {
        name: name.name,
        formula: scope === undefined ? name.formula : FORMULA_CODEC.store(name.formula, { sheetId: scope, row: 0, column: 0, workbook }),
      });
    });
    const snapshot = Y.encodeStateAsUpdate(doc);
    if (snapshot.length > SNAPSHOT_RAW_BYTES_LIMIT) {
      throw new ImportTooLargeError({ reason: 'workbook-full', usedBytes: 0, addedBytes: snapshot.length, limitBytes: SNAPSHOT_RAW_BYTES_LIMIT });
    }
    return { snapshot, report: imported.report, sheets: readSheets(doc).length };
  } finally {
    doc.destroy();
  }
}

export function exportedNames(doc: Y.Doc): ExportedName[] {
  const workbook = new WorkbookIndex(doc);
  const scope = workbook.sheetIds()[0];
  return [...readNames(doc).values()].map((name) => ({
    name: name.name,
    formula:
      scope === undefined
        ? name.formula
        : FORMULA_CODEC.display(name.formula, { sheetId: name.sheetId ?? scope, row: 0, column: 0, workbook }),
  }));
}

export async function exportXlsx(workbook: IWorkbookData, doc: Y.Doc): Promise<Uint8Array> {
  return writeXlsx(workbook, exportedNames(doc), featureRulesOfWorkbook(doc, FORMULA_CODEC));
}

export function exportDelimited(workbook: IWorkbookData, sheetId: string, delimiter: Delimiter): string {
  const sheet = workbook.sheets[sheetId];
  return sheet === undefined ? '' : sheetToDelimited(sheet, delimiter);
}

export function exportFileName(title: string, extension: 'xlsx' | 'csv' | 'tsv', fallback: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${base === '' ? fallback : base}.${extension}`;
}
