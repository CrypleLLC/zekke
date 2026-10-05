import type { Axis } from './axis';

export interface IdRange {
  startRow?: string;
  endRow?: string;
  startColumn?: string;
  endColumn?: string;
}

export interface IndexRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  wholeRows: boolean;
  wholeColumns: boolean;
}

export interface GridRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  rangeType?: number;
}

export const RANGE_TYPE_NORMAL = 0;
export const RANGE_TYPE_ROW = 1;
export const RANGE_TYPE_COLUMN = 2;
export const RANGE_TYPE_ALL = 3;

export function anchorRange(range: GridRange, rows: Axis, columns: Axis): IdRange | undefined {
  const type = range.rangeType ?? RANGE_TYPE_NORMAL;
  const anchored: IdRange = {};

  if (type !== RANGE_TYPE_COLUMN && type !== RANGE_TYPE_ALL) {
    const startRow = rows.idAt(range.startRow);
    const endRow = rows.idAt(range.endRow);
    if (startRow === undefined || endRow === undefined) {
      return undefined;
    }
    anchored.startRow = startRow;
    anchored.endRow = endRow;
  }

  if (type !== RANGE_TYPE_ROW && type !== RANGE_TYPE_ALL) {
    const startColumn = columns.idAt(range.startColumn);
    const endColumn = columns.idAt(range.endColumn);
    if (startColumn === undefined || endColumn === undefined) {
      return undefined;
    }
    anchored.startColumn = startColumn;
    anchored.endColumn = endColumn;
  }

  return anchored;
}

export function resolveRange(range: IdRange, rows: Axis, columns: Axis): IndexRange | undefined {
  const rowSpan = resolveSpan(range.startRow, range.endRow, rows);
  const columnSpan = resolveSpan(range.startColumn, range.endColumn, columns);
  if (rowSpan === undefined || columnSpan === undefined) {
    return undefined;
  }
  return {
    startRow: rowSpan.start,
    endRow: rowSpan.end,
    startColumn: columnSpan.start,
    endColumn: columnSpan.end,
    wholeColumns: rowSpan.unbounded,
    wholeRows: columnSpan.unbounded,
  };
}

function resolveSpan(
  startId: string | undefined,
  endId: string | undefined,
  axis: Axis,
): { start: number; end: number; unbounded: boolean } | undefined {
  if (startId === undefined || endId === undefined) {
    if (axis.size === 0) {
      return undefined;
    }
    return { start: 0, end: axis.size - 1, unbounded: true };
  }
  const start = axis.startIndexOf(startId);
  const end = axis.endIndexOf(endId);
  if (start === undefined || end === undefined || start > end) {
    return undefined;
  }
  return { start, end, unbounded: false };
}

export function toGridRange(range: IndexRange): GridRange {
  const type =
    range.wholeRows && range.wholeColumns
      ? RANGE_TYPE_ALL
      : range.wholeRows
        ? RANGE_TYPE_ROW
        : range.wholeColumns
          ? RANGE_TYPE_COLUMN
          : RANGE_TYPE_NORMAL;
  return {
    startRow: range.startRow,
    endRow: range.endRow,
    startColumn: range.startColumn,
    endColumn: range.endColumn,
    rangeType: type,
  };
}

export function isIdRange(value: unknown): value is IdRange {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const range = value as Record<string, unknown>;
  const optionalString = (key: string) => range[key] === undefined || typeof range[key] === 'string';
  const paired = (a: string, b: string) => (range[a] === undefined) === (range[b] === undefined);
  return (
    optionalString('startRow') &&
    optionalString('endRow') &&
    optionalString('startColumn') &&
    optionalString('endColumn') &&
    paired('startRow', 'endRow') &&
    paired('startColumn', 'endColumn')
  );
}
