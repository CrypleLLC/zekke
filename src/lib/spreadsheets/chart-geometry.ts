import type { CellPosition, GridAnchor } from './charts';
import { columnLetters } from './formulas';
import type { GridRange } from './ranges';

export interface LineLayout {
  origin: number;
  ends: readonly number[];
}

export interface ContentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const DEFAULT_CHART_SIZE = { width: 480, height: 300 };
export const MIN_CHART_SIZE = { width: 160, height: 120 };
export const CHART_GAP_COLUMNS = 1;

export function lineStart(layout: LineLayout, index: number): number {
  const clamped = Math.min(Math.max(index, 0), layout.ends.length);
  return layout.origin + (clamped === 0 ? 0 : layout.ends[clamped - 1]);
}

export function lineSize(layout: LineLayout, index: number): number {
  if (index < 0 || index >= layout.ends.length) {
    return 0;
  }
  return layout.ends[index] - (index === 0 ? 0 : layout.ends[index - 1]);
}

export function lineAt(layout: LineLayout, coordinate: number): { index: number; offset: number } {
  const count = layout.ends.length;
  if (count === 0) {
    return { index: 0, offset: 0 };
  }
  const relative = coordinate - layout.origin;
  if (relative <= 0) {
    return { index: 0, offset: 0 };
  }
  if (relative >= layout.ends[count - 1]) {
    return { index: count - 1, offset: lineSize(layout, count - 1) };
  }
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (layout.ends[middle] <= relative) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return { index: low, offset: relative - (low === 0 ? 0 : layout.ends[low - 1]) };
}

function pointOf(layout: LineLayout, index: number, offset: number): number {
  return lineStart(layout, index) + Math.min(Math.max(offset, 0), lineSize(layout, index));
}

export function anchorRect(rows: LineLayout, columns: LineLayout, anchor: GridAnchor): ContentRect {
  const left = pointOf(columns, anchor.from.column, anchor.from.columnOffset);
  const top = pointOf(rows, anchor.from.row, anchor.from.rowOffset);
  const right = pointOf(columns, anchor.to.column, anchor.to.columnOffset);
  const bottom = pointOf(rows, anchor.to.row, anchor.to.rowOffset);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function positionAt(rows: LineLayout, columns: LineLayout, x: number, y: number): CellPosition {
  const row = lineAt(rows, y);
  const column = lineAt(columns, x);
  return { row: row.index, column: column.index, rowOffset: row.offset, columnOffset: column.offset };
}

export function anchorFromRect(rows: LineLayout, columns: LineLayout, rect: ContentRect): GridAnchor {
  const width = Math.max(rect.width, MIN_CHART_SIZE.width);
  const height = Math.max(rect.height, MIN_CHART_SIZE.height);
  return {
    from: positionAt(rows, columns, rect.left, rect.top),
    to: positionAt(rows, columns, rect.left + width, rect.top + height),
  };
}

export function defaultChartAnchor(
  rows: LineLayout,
  columns: LineLayout,
  source: GridRange,
  size: { width: number; height: number } = DEFAULT_CHART_SIZE,
): GridAnchor {
  const column = Math.min(source.endColumn + 1 + CHART_GAP_COLUMNS, Math.max(columns.ends.length - 1, 0));
  const left = lineStart(columns, column);
  const top = lineStart(rows, source.startRow);
  return anchorFromRect(rows, columns, { left, top, ...size });
}

export function movedRect(rect: ContentRect, deltaX: number, deltaY: number, rows: LineLayout, columns: LineLayout): ContentRect {
  const minLeft = columns.origin;
  const minTop = rows.origin;
  return { ...rect, left: Math.max(minLeft, rect.left + deltaX), top: Math.max(minTop, rect.top + deltaY) };
}

export function resizedRect(rect: ContentRect, deltaX: number, deltaY: number): ContentRect {
  return {
    ...rect,
    width: Math.max(MIN_CHART_SIZE.width, rect.width + deltaX),
    height: Math.max(MIN_CHART_SIZE.height, rect.height + deltaY),
  };
}

export function isChartableRange(range: GridRange): boolean {
  return range.endRow > range.startRow || range.endColumn > range.startColumn;
}

export function rangeLabel(range: GridRange): string {
  const start = `${columnLetters(range.startColumn)}${range.startRow + 1}`;
  const end = `${columnLetters(range.endColumn)}${range.endRow + 1}`;
  return start === end ? start : `${start}:${end}`;
}
