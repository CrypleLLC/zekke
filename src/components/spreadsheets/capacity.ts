import type { IWorksheetData } from '@univerjs/core';
import * as Y from 'yjs';
import {
  CAPACITY_NEAR_FRACTION,
  LINE_BYTES,
  OVERWRITTEN_CELL_BYTES,
  SNAPSHOT_RAW_BYTES_LIMIT,
  checkCapacity,
  estimateCellDataBytes,
  type CapacityRefusal,
  type CellData,
} from '@/lib/spreadsheets';
import type { UniverSurface } from './surface';

export class CapacityGauge {
  private estimate: number | undefined;
  private readonly onUpdate = (update: Uint8Array) => {
    if (this.estimate !== undefined) {
      this.estimate += update.length;
    }
  };

  constructor(
    private readonly doc: Y.Doc,
    readonly limitBytes = SNAPSHOT_RAW_BYTES_LIMIT,
  ) {
    doc.on('update', this.onUpdate);
  }

  measure(): number {
    this.estimate = Y.encodeStateAsUpdate(this.doc).length;
    return this.estimate;
  }

  usedBytes(): number {
    return this.estimate ?? this.measure();
  }

  refusal(addedBytes: number, largestCellBytes: number): CapacityRefusal | undefined {
    if (addedBytes <= 0 && largestCellBytes === 0) {
      return undefined;
    }
    const estimated = this.usedBytes();
    const near = estimated + addedBytes > this.limitBytes * CAPACITY_NEAR_FRACTION;
    return checkCapacity(near ? this.measure() : estimated, addedBytes, largestCellBytes, this.limitBytes);
  }

  dispose(): void {
    this.doc.off('update', this.onUpdate);
  }
}

export interface Growth {
  addedBytes: number;
  largestCellBytes: number;
}

const NO_GROWTH: Growth = { addedBytes: 0, largestCellBytes: 0 };

function cellsGrowth(
  surface: UniverSurface,
  sheetId: string,
  cells: Record<string, Record<string, CellData | null | undefined> | null | undefined>,
): Growth {
  let addedBytes = 0;
  let largestCellBytes = 0;
  for (const [rowKey, row] of Object.entries(cells)) {
    for (const [columnKey, cell] of Object.entries(row ?? {})) {
      const next = estimateCellDataBytes({ ...surface.rawCell(sheetId, Number(rowKey), Number(columnKey)), ...(cell ?? {}) } as CellData);
      const previous = estimateCellDataBytes(surface.rawCell(sheetId, Number(rowKey), Number(columnKey)) as CellData);
      addedBytes += Math.max(0, next.bytes - previous.bytes) + (previous.bytes > 0 ? OVERWRITTEN_CELL_BYTES : 0);
      largestCellBytes = Math.max(largestCellBytes, next.contentBytes);
    }
  }
  return { addedBytes, largestCellBytes };
}

export function mutationGrowth(surface: UniverSurface, id: string, params: Record<string, unknown>): Growth {
  const sheetId = params.subUnitId as string | undefined;
  const range = params.range as { startRow: number; endRow: number; startColumn: number; endColumn: number } | undefined;
  const worksheet = sheetId === undefined ? undefined : surface.worksheet(sheetId);

  switch (id) {
    case 'sheet.mutation.set-range-values':
      return sheetId === undefined
        ? NO_GROWTH
        : cellsGrowth(surface, sheetId, (params.cellValue ?? {}) as Record<string, Record<string, CellData>>);
    case 'sheet.mutation.insert-row':
      return { addedBytes: range === undefined ? 0 : (range.endRow - range.startRow + 1) * LINE_BYTES, largestCellBytes: 0 };
    case 'sheet.mutation.insert-col':
      return {
        addedBytes: range === undefined ? 0 : (range.endColumn - range.startColumn + 1) * LINE_BYTES,
        largestCellBytes: 0,
      };
    case 'sheet.mutation.set-worksheet-row-count':
      return {
        addedBytes: Math.max(0, (params.rowCount as number) - (worksheet?.getRowCount() ?? 0)) * LINE_BYTES,
        largestCellBytes: 0,
      };
    case 'sheet.mutation.set-worksheet-column-count':
      return {
        addedBytes: Math.max(0, (params.columnCount as number) - (worksheet?.getColumnCount() ?? 0)) * LINE_BYTES,
        largestCellBytes: 0,
      };
    case 'sheet.mutation.insert-sheet': {
      const sheet = params.sheet as Partial<IWorksheetData>;
      let addedBytes = ((sheet.rowCount ?? 0) + (sheet.columnCount ?? 0)) * LINE_BYTES;
      let largestCellBytes = 0;
      for (const row of Object.values(sheet.cellData ?? {})) {
        for (const cell of Object.values(row ?? {})) {
          const estimate = estimateCellDataBytes(cell as CellData);
          addedBytes += estimate.bytes;
          largestCellBytes = Math.max(largestCellBytes, estimate.contentBytes);
        }
      }
      return { addedBytes, largestCellBytes };
    }
  }
  return NO_GROWTH;
}
