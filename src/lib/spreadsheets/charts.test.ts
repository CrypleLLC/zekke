import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  CHART_MAX_SERIES,
  CHART_PALETTE,
  chartOption,
  chartTable,
  createSheet,
  insertLines,
  markSpreadsheet,
  normaliseSettings,
  readCharts,
  readSheet,
  removeLines,
  writeChart,
  type ChartSettings,
  type SheetMap,
} from './index';

function sheet(): SheetMap {
  const doc = new Y.Doc();
  markSpreadsheet(doc);
  return readSheet(doc, createSheet(doc, { name: 'Sheet1', rows: 30, columns: 12 })) as SheetMap;
}

const CHART = {
  settings: { kind: 'column', headers: true, series: 'columns', title: 'Spend' } as ChartSettings,
  source: { startRow: 0, endRow: 3, startColumn: 0, endColumn: 2 },
  anchor: {
    from: { row: 1, column: 4, rowOffset: 5, columnOffset: 10 },
    to: { row: 12, column: 9, rowOffset: 0, columnOffset: 20 },
  },
};

describe('a chart in the CRDT', () => {
  it('is stored by ids and read back at the same positions', () => {
    const target = sheet();
    writeChart(target, 'c1', CHART);
    expect(readCharts(target)).toEqual([{ id: 'c1', ...CHART }]);
  });

  it('moves with rows inserted above it and grows with rows inserted inside its data', () => {
    const target = sheet();
    writeChart(target, 'c1', CHART);
    insertLines(target, 'rows', 0, 2);
    insertLines(target, 'rows', 4, 1);
    const [chart] = readCharts(target);
    expect(chart.source).toMatchObject({ startRow: 2, endRow: 6 });
    expect(chart.anchor.from.row).toBe(3);
    expect(chart.anchor.to.row).toBe(15);
    expect(chart.anchor.from.rowOffset).toBe(5);
  });

  it('shrinks when rows under it are removed, and never turns inside out', () => {
    const target = sheet();
    writeChart(target, 'c1', CHART);
    removeLines(target, 'rows', 1, 12);
    const [chart] = readCharts(target);
    expect(chart.anchor.from.row).toBeLessThanOrEqual(chart.anchor.to.row);
  });

  it('writes nothing when its box lies outside the sheet', () => {
    const target = sheet();
    const outside = { ...CHART, anchor: { ...CHART.anchor, to: { ...CHART.anchor.to, column: 40 } } };
    expect(writeChart(target, 'c1', outside)).toBe(false);
    expect(readCharts(target)).toEqual([]);
  });

  it('cleans settings it does not recognise', () => {
    expect(normaliseSettings({ kind: 'radar', series: 'diagonal', title: '  ', extra: 1 })).toEqual({
      kind: 'column',
      headers: true,
      series: 'columns',
    });
  });
});

describe('reading a range as a chart', () => {
  const grid = [
    ['Month', 'Rent', 'Food'],
    ['Jan', 1200, 450.5],
    ['Feb', 1200, '380'],
    ['Mar', null, 510],
  ];

  it('takes the header row as series names and a text first column as categories', () => {
    expect(chartTable({ kind: 'column', headers: true, series: 'columns' }, grid)).toEqual({
      categories: ['Jan', 'Feb', 'Mar'],
      series: [
        { name: 'Rent', values: [1200, 1200, null] },
        { name: 'Food', values: [450.5, 380, 510] },
      ],
    });
  });

  it('reads series in rows', () => {
    const table = chartTable({ kind: 'line', headers: true, series: 'rows' }, grid);
    expect(table.categories).toEqual(['Rent', 'Food']);
    expect(table.series.map((series) => series.name)).toEqual(['Jan', 'Feb', 'Mar']);
  });

  it('numbers the points when there are no labels, and names unnamed series', () => {
    const table = chartTable({ kind: 'line', headers: false, series: 'columns' }, [[1, 2], [3, 4]]);
    expect(table.categories).toEqual(['1', '2']);
    expect(table.series.map((series) => series.name)).toEqual(['Series 1', 'Series 2']);
  });

  it('caps the series at the palette, so a colour is never cycled', () => {
    const wide = [Array.from({ length: 14 }, (_, column) => column + 1)];
    expect(chartTable({ kind: 'line', headers: false, series: 'columns' }, wide).series).toHaveLength(CHART_MAX_SERIES);
  });
});

interface DrawnChart {
  color: unknown;
  xAxis: { type: string };
  yAxis: { type: string };
  title: { text: string };
  legend: { show: boolean };
  series: { data: unknown; areaStyle?: unknown }[];
}

function drawn(option: unknown): DrawnChart {
  return option as DrawnChart;
}

describe('the chart drawn', () => {
  const grid = [
    ['Month', 'Rent', 'Food'],
    ['Jan', 1200, 450],
    ['Feb', 1100, 380],
  ];
  const option = (kind: ChartSettings['kind'], title?: string) =>
    drawn(chartOption({ kind, headers: true, series: 'columns', title }, grid));

  it('draws columns with rounded data ends on a category axis, in the fixed palette', () => {
    const column = option('column', 'Spend');
    expect(column.color).toEqual([...CHART_PALETTE]);
    expect(column.xAxis.type).toBe('category');
    expect(column.series[0]).toMatchObject({ type: 'bar', name: 'Rent', itemStyle: { borderRadius: [4, 4, 0, 0] } });
    expect(column.title.text).toBe('Spend');
    expect(column.legend.show).toBe(true);
  });

  it('turns bars sideways, fills areas, and keeps lines at two pixels', () => {
    expect(option('bar').yAxis.type).toBe('category');
    expect(option('line').series[0]).toMatchObject({ type: 'line', lineStyle: { width: 2 } });
    expect(option('area').series[0].areaStyle).toBeDefined();
  });

  it('draws a pie from the first series, with a legend for its slices', () => {
    const pie = option('pie');
    expect(pie.series[0].data).toEqual([
      { name: 'Jan', value: 1200 },
      { name: 'Feb', value: 1100 },
    ]);
    expect(pie.legend.show).toBe(true);
  });

  it('shows no legend for a single series, whose title already names it', () => {
    const single = drawn(chartOption({ kind: 'line', headers: true, series: 'columns' }, [['Month', 'Rent'], ['Jan', 1]]));
    expect(single.legend.show).toBe(false);
  });

  it('plots the first series against the others for a scatter', () => {
    const scatter = drawn(chartOption({ kind: 'scatter', headers: true, series: 'columns' }, [['x', 'y'], [1, 2], [3, 4]]));
    expect(scatter.series[0].data).toEqual([[1, 2], [3, 4]]);
  });
});
