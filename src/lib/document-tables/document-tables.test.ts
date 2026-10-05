import { describe, expect, it } from 'vitest';
import {
  MAX_ROW_HEIGHT_PX,
  MAX_TABLE_COLUMNS,
  MIN_ROW_HEIGHT_PX,
  MIN_COLUMN_WIDTH_PX,
  clampTableSize,
  dragColumnBorder,
  fitColumnWidths,
  evenColumnWidths,
  rowHeightAfterDrag,
  safeRowHeight,
  scaleColumnWidths,
} from './index';

const sum = (widths: readonly number[]) => widths.reduce((total, width) => total + width, 0);

describe('table sizes', () => {
  it('keeps rows and columns whole and in range', () => {
    expect(clampTableSize(3.4, MAX_TABLE_COLUMNS)).toBe(3);
    expect(clampTableSize(0, MAX_TABLE_COLUMNS)).toBe(1);
    expect(clampTableSize(500, MAX_TABLE_COLUMNS)).toBe(MAX_TABLE_COLUMNS);
    expect(clampTableSize(Number.NaN, MAX_TABLE_COLUMNS)).toBe(1);
  });
});

describe('column widths', () => {
  it('splits a width evenly in whole pixels that add up to it', () => {
    const widths = evenColumnWidths(605, 4);
    expect(widths).toEqual([152, 151, 151, 151]);
    expect(sum(widths)).toBe(605);
  });

  it('never makes a column narrower than the minimum', () => {
    expect(evenColumnWidths(10, 3)).toEqual(Array(3).fill(MIN_COLUMN_WIDTH_PX));
  });

  it('scales a table to a new width keeping the columns in proportion', () => {
    const widths = scaleColumnWidths([100, 200, 100], 800);
    expect(widths).toEqual([200, 400, 200]);
    expect(sum(scaleColumnWidths([100, 200, 101], 777))).toBe(777);
  });

  it('scales an unmeasured table as an even split', () => {
    expect(scaleColumnWidths([0, 0], 300)).toEqual([150, 150]);
    expect(scaleColumnWidths([], 300)).toEqual([]);
  });

});

describe('row heights', () => {
  it('keeps a whole number of pixels within range, from the attribute or from pasted CSS', () => {
    expect(safeRowHeight(48)).toBe(48);
    expect(safeRowHeight('48px')).toBe(48);
    expect(safeRowHeight(' 47.6px ')).toBe(48);
    expect(safeRowHeight(MIN_ROW_HEIGHT_PX)).toBe(MIN_ROW_HEIGHT_PX);
  });

  it('refuses anything else, so nothing but a length ever reaches the style', () => {
    for (const value of [null, undefined, 3, 99999, '2em', '48px; background: url(x)', 'auto', Number.NaN]) {
      expect(safeRowHeight(value)).toBeUndefined();
    }
  });

  it('turns a drag into a layout height, undoing the page scale and clamping', () => {
    expect(rowHeightAfterDrag(40, 20, 1)).toBe(60);
    expect(rowHeightAfterDrag(40, 20, 0.5)).toBe(80);
    expect(rowHeightAfterDrag(40, -100, 1)).toBe(MIN_ROW_HEIGHT_PX);
    expect(rowHeightAfterDrag(40, 1e6, 1)).toBe(MAX_ROW_HEIGHT_PX);
  });
});

describe('dragging a column border', () => {
  it('moves width between the two neighbours of an inner border, keeping the table width', () => {
    const widths = dragColumnBorder([100, 200, 100], 0, 50, 600);
    expect(widths).toEqual([150, 150, 100]);
    expect(sum(widths)).toBe(400);
  });

  it('stops an inner border before either neighbour falls under the minimum', () => {
    expect(dragColumnBorder([100, 200, 100], 0, 1000, 600)).toEqual([300 - MIN_COLUMN_WIDTH_PX, MIN_COLUMN_WIDTH_PX, 100]);
    expect(dragColumnBorder([100, 200, 100], 1, -1000, 600)).toEqual([100, MIN_COLUMN_WIDTH_PX, 300 - MIN_COLUMN_WIDTH_PX]);
  });

  it('grows the table from its last border only up to the width available', () => {
    expect(dragColumnBorder([100, 200, 100], 2, 50, 600)).toEqual([100, 200, 150]);
    expect(dragColumnBorder([100, 200, 100], 2, 5000, 600)).toEqual([100, 200, 300]);
    expect(sum(dragColumnBorder([100, 200, 100], 2, 5000, 600))).toBe(600);
  });

  it('lets the last border shrink the table, down to the minimum', () => {
    expect(dragColumnBorder([100, 200, 100], 2, -1000, 600)).toEqual([100, 200, MIN_COLUMN_WIDTH_PX]);
  });

  it('ignores a column that is not there', () => {
    expect(dragColumnBorder([100, 200], 5, 10, 600)).toEqual([100, 200]);
  });
});

describe('fitting a table to the text', () => {
  it('scales a table wider than the text down in proportion', () => {
    const widths = fitColumnWidths([200, 400, 200], 600);
    expect(sum(widths)).toBe(600);
    expect(widths).toEqual([150, 300, 150]);
  });

  it('leaves a table that already fits alone', () => {
    expect(fitColumnWidths([100, 200], 600)).toEqual([100, 200]);
  });
});
