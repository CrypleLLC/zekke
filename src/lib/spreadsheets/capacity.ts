import type { IWorkbookData } from '@univerjs/core';
import { MAX_SNAPSHOT_CHARACTERS } from '@/lib/documents/records';
import type { DocumentSyncOptions } from '@/lib/documents/sync';
import { encodeContent, type CellContent, type CellData } from './cells';
import { tokenizeFormula } from './formulas';

export const SPREADSHEET_SYNC_OPTIONS: Pick<
  DocumentSyncOptions,
  'compactThreshold' | 'compactLogRatio' | 'compactMinLogBytes'
> = {
  compactThreshold: 2048,
  compactLogRatio: 0.25,
  compactMinLogBytes: 64 * 1024,
};

const SEALED_OVERHEAD_BYTES = 29;
export const SNAPSHOT_RAW_BYTES_LIMIT = Math.floor((MAX_SNAPSHOT_CHARACTERS * 3) / 4) - SEALED_OVERHEAD_BYTES - 64;
export const CAPACITY_NEAR_FRACTION = 0.9;
export const MAX_CELL_BYTES = 64 * 1024;
export const CELL_OVERHEAD_BYTES = 22;
export const STYLED_CELL_BYTES = 26;
export const STORED_CELL_REFERENCE_BYTES = 30;
export const STORED_RANGE_REFERENCE_BYTES = 44;
export const STORED_SHEET_BYTES = 10;
export const LINE_BYTES = 24;
export const OVERWRITTEN_CELL_BYTES = 12;
export const AVERAGE_CELL_BYTES = 30;

const encoder = new TextEncoder();

export function contentBytes(content: CellContent): number {
  if (typeof content === 'number') {
    return 9;
  }
  if (typeof content === 'boolean') {
    return 1;
  }
  if (typeof content === 'string') {
    return encoder.encode(content).length + 2;
  }
  if ('f' in content) {
    return storedFormulaBytes(content.f);
  }
  return encoder.encode(JSON.stringify(content)).length;
}

function storedFormulaBytes(formula: string): number {
  let bytes = 6;
  for (const piece of tokenizeFormula(formula)) {
    if (!('reference' in piece)) {
      bytes += encoder.encode(piece.text).length;
      continue;
    }
    bytes += piece.reference.kind === 'cell' ? STORED_CELL_REFERENCE_BYTES : STORED_RANGE_REFERENCE_BYTES;
    if (piece.reference.sheetName !== undefined) {
      bytes += STORED_SHEET_BYTES;
    }
  }
  return bytes;
}

export function estimateCellBytes(content: CellContent | undefined, styled: boolean): number {
  if (content === undefined && !styled) {
    return 0;
  }
  return CELL_OVERHEAD_BYTES + (content === undefined ? 0 : contentBytes(content)) + (styled ? STYLED_CELL_BYTES : 0);
}

export function estimateCellDataBytes(cell: CellData | null | undefined): { bytes: number; contentBytes: number } {
  if (cell === null || cell === undefined) {
    return { bytes: 0, contentBytes: 0 };
  }
  let content: CellContent | undefined;
  try {
    content = encodeContent({ ...cell, si: null }, (formula) => formula);
  } catch {
    content = undefined;
  }
  const styled = cell.s !== undefined && cell.s !== null;
  return {
    bytes: estimateCellBytes(content, styled),
    contentBytes: content === undefined ? 0 : contentBytes(content),
  };
}

export type CapacityRefusalReason = 'workbook-full' | 'cell-too-large';

export interface CapacityRefusal {
  reason: CapacityRefusalReason;
  usedBytes: number;
  addedBytes: number;
  limitBytes: number;
}

export function checkCapacity(
  usedBytes: number,
  addedBytes: number,
  largestCellBytes: number,
  limitBytes = SNAPSHOT_RAW_BYTES_LIMIT,
): CapacityRefusal | undefined {
  if (largestCellBytes > MAX_CELL_BYTES) {
    return { reason: 'cell-too-large', usedBytes, addedBytes, limitBytes };
  }
  if (usedBytes + addedBytes > limitBytes) {
    return { reason: 'workbook-full', usedBytes, addedBytes, limitBytes };
  }
  return undefined;
}

export function estimateWorkbookBytes(data: IWorkbookData): { bytes: number; largestCellBytes: number } {
  let bytes = 0;
  let largestCellBytes = 0;
  for (const sheet of Object.values(data.sheets)) {
    if (sheet === undefined) {
      continue;
    }
    bytes += ((sheet.rowCount ?? 0) + (sheet.columnCount ?? 0)) * LINE_BYTES;
    for (const row of Object.values(sheet.cellData ?? {})) {
      for (const cell of Object.values(row ?? {})) {
        const estimate = estimateCellDataBytes(cell as CellData);
        bytes += estimate.bytes;
        largestCellBytes = Math.max(largestCellBytes, estimate.contentBytes);
      }
    }
  }
  return { bytes, largestCellBytes };
}

export function cellsInBytes(bytes: number): number {
  return Math.max(0, Math.floor(bytes / AVERAGE_CELL_BYTES));
}
