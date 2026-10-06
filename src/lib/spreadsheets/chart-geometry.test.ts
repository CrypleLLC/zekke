import { describe, expect, it } from 'vitest';
import {
  MIN_CHART_SIZE,
  anchorFromRect,
  anchorRect,
  defaultChartAnchor,
  isChartableRange,
  lineAt,
  lineSize,
  lineStart,
  movedRect,
  rangeLabel,
  resizedRect,
  type LineLayout,
} from './index';

const rows: LineLayout = { origin: 20, ends: [24, 48, 72, 96, 120, 144, 168, 192, 216, 240, 264, 288, 312, 336, 360] };
const columns: LineLayout = { origin: 46, ends: [100, 200, 300, 350, 450, 550, 650, 750, 850, 950] };

describe('lines on the grid', () => {
  it('starts each line after the header and the lines before it', () => {
    expect(lineStart(columns, 0)).toBe(46);
    expect(lineStart(columns, 3)).toBe(346);
    expect(lineSize(columns, 3)).toBe(50);
    expect(lineSize(columns, 99)).toBe(0);
  });

  it('finds the line under a coordinate, and the offset inside it', () => {
    expect(lineAt(columns, 46)).toEqual({ index: 0, offset: 0 });
    expect(lineAt(columns, 145)).toEqual({ index: 0, offset: 99 });
    expect(lineAt(columns, 146)).toEqual({ index: 1, offset: 0 });
    expect(lineAt(columns, 370)).toEqual({ index: 3, offset: 24 });
  });

  it('clamps before the first line and past the last', () => {
    expect(lineAt(columns, 0)).toEqual({ index: 0, offset: 0 });
    expect(lineAt(columns, 5000)).toEqual({ index: 9, offset: 100 });
    expect(lineAt({ origin: 0, ends: [] }, 10)).toEqual({ index: 0, offset: 0 });
  });

  it('skips a hidden line, whose size is zero', () => {
    const hidden: LineLayout = { origin: 0, ends: [10, 10, 20] };
    expect(lineAt(hidden, 10)).toEqual({ index: 2, offset: 0 });
  });
});

describe('a chart box', () => {
  it('round-trips between a box and its anchor', () => {
    const rect = { left: 400, top: 50, width: 480, height: 300 };
    const anchor = anchorFromRect(rows, columns, rect);
    expect(anchor.from).toEqual({ row: 1, column: 4, rowOffset: 6, columnOffset: 4 });
    expect(anchorRect(rows, columns, anchor)).toEqual(rect);
  });

  it('never stores a box smaller than the minimum', () => {
    const anchor = anchorFromRect(rows, columns, { left: 46, top: 20, width: 10, height: 10 });
    const rect = anchorRect(rows, columns, anchor);
    expect(rect.width).toBe(MIN_CHART_SIZE.width);
    expect(rect.height).toBe(MIN_CHART_SIZE.height);
  });

  it('clamps an offset that a narrowed column no longer has room for', () => {
    const anchor = {
      from: { row: 0, column: 3, rowOffset: 0, columnOffset: 400 },
      to: { row: 5, column: 6, rowOffset: 0, columnOffset: 0 },
    };
    expect(anchorRect(rows, columns, anchor).left).toBe(lineStart(columns, 3) + lineSize(columns, 3));
  });

  it('is placed beside its data, one column apart, level with its first row', () => {
    const anchor = defaultChartAnchor(rows, columns, { startRow: 2, endRow: 6, startColumn: 0, endColumn: 1 });
    expect(anchor.from).toEqual({ row: 2, column: 3, rowOffset: 0, columnOffset: 0 });
  });

  it('moves without leaving the grid, and resizes without shrinking below the minimum', () => {
    const rect = { left: 100, top: 40, width: 300, height: 200 };
    expect(movedRect(rect, -500, -500, rows, columns)).toMatchObject({ left: 46, top: 20 });
    expect(resizedRect(rect, -1000, 30)).toEqual({ ...rect, width: MIN_CHART_SIZE.width, height: 230 });
  });
});

describe('the data range', () => {
  it('needs more than one cell', () => {
    expect(isChartableRange({ startRow: 1, endRow: 1, startColumn: 2, endColumn: 2 })).toBe(false);
    expect(isChartableRange({ startRow: 1, endRow: 4, startColumn: 2, endColumn: 2 })).toBe(true);
  });

  it('is named in A1', () => {
    expect(rangeLabel({ startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 })).toBe('A1:C4');
    expect(rangeLabel({ startRow: 4, endRow: 4, startColumn: 27, endColumn: 27 })).toBe('AB5');
  });
});
