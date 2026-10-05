import type { Axis } from './axis';
import { readAxis } from './axis';
import type { SheetMap } from './layout';
import { anchorRange, type GridRange, type IdRange } from './ranges';
import { readRules, writeRule } from './rules';

export const CHART_FEATURE = 'chart';
export const CHART_COMPONENT = 'zekke.chart';

export const CHART_KINDS = ['column', 'bar', 'line', 'area', 'pie', 'scatter'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];
export type SeriesOrientation = 'columns' | 'rows';

export const CHART_PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'] as const;
export const CHART_MAX_SERIES = CHART_PALETTE.length;
export const CHART_INK = { primary: '#1f2937', secondary: '#4b5563', muted: '#9ca3af', grid: '#e5e7eb', surface: '#ffffff' };

export interface ChartSettings {
  kind: ChartKind;
  title?: string;
  headers: boolean;
  series: SeriesOrientation;
}

export interface CellPosition {
  row: number;
  column: number;
  rowOffset: number;
  columnOffset: number;
}

export interface GridAnchor {
  from: CellPosition;
  to: CellPosition;
}

export interface StoredAnchor {
  fromRow: string;
  fromColumn: string;
  fromRowOffset: number;
  fromColumnOffset: number;
  toRow: string;
  toColumn: string;
  toRowOffset: number;
  toColumnOffset: number;
}

export interface StoredChart {
  settings: ChartSettings;
  anchor: StoredAnchor;
}

export interface ChartData {
  settings: ChartSettings;
  source: GridRange;
}

export interface ResolvedChart extends ChartData {
  id: string;
  anchor: GridAnchor;
}

export function isChartKind(value: unknown): value is ChartKind {
  return typeof value === 'string' && (CHART_KINDS as readonly string[]).includes(value);
}

export function normaliseSettings(value: unknown): ChartSettings {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const settings: ChartSettings = {
    kind: isChartKind(record.kind) ? record.kind : 'column',
    headers: record.headers !== false,
    series: record.series === 'rows' ? 'rows' : 'columns',
  };
  if (typeof record.title === 'string' && record.title.trim() !== '') {
    settings.title = record.title.slice(0, 200);
  }
  return settings;
}

export function isChartData(value: unknown): value is ChartData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const source = record.source as Record<string, unknown> | undefined;
  return (
    typeof record.settings === 'object' &&
    source !== undefined &&
    ['startRow', 'endRow', 'startColumn', 'endColumn'].every((key) => typeof source[key] === 'number')
  );
}

export function anchorChart(anchor: GridAnchor, rows: Axis, columns: Axis): StoredAnchor | undefined {
  const fromRow = rows.idAt(anchor.from.row);
  const fromColumn = columns.idAt(anchor.from.column);
  const toRow = rows.idAt(anchor.to.row);
  const toColumn = columns.idAt(anchor.to.column);
  if (fromRow === undefined || fromColumn === undefined || toRow === undefined || toColumn === undefined) {
    return undefined;
  }
  return {
    fromRow,
    fromColumn,
    fromRowOffset: anchor.from.rowOffset,
    fromColumnOffset: anchor.from.columnOffset,
    toRow,
    toColumn,
    toRowOffset: anchor.to.rowOffset,
    toColumnOffset: anchor.to.columnOffset,
  };
}

export function resolveAnchor(anchor: StoredAnchor, rows: Axis, columns: Axis): GridAnchor | undefined {
  const fromRow = rows.startIndexOf(anchor.fromRow) ?? rows.endIndexOf(anchor.fromRow);
  const fromColumn = columns.startIndexOf(anchor.fromColumn) ?? columns.endIndexOf(anchor.fromColumn);
  if (fromRow === undefined || fromColumn === undefined) {
    return undefined;
  }
  const toRow = Math.max(fromRow, rows.endIndexOf(anchor.toRow) ?? fromRow);
  const toColumn = Math.max(fromColumn, columns.endIndexOf(anchor.toColumn) ?? fromColumn);
  return {
    from: { row: fromRow, column: fromColumn, rowOffset: anchor.fromRowOffset, columnOffset: anchor.fromColumnOffset },
    to: { row: toRow, column: toColumn, rowOffset: anchor.toRowOffset, columnOffset: anchor.toColumnOffset },
  };
}

function isStoredAnchor(value: unknown): value is StoredAnchor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    ['fromRow', 'fromColumn', 'toRow', 'toColumn'].every((key) => typeof record[key] === 'string') &&
    ['fromRowOffset', 'fromColumnOffset', 'toRowOffset', 'toColumnOffset'].every((key) => typeof record[key] === 'number')
  );
}

export function chartRuleBody(settings: ChartSettings, anchor: StoredAnchor): StoredChart {
  return { settings: normaliseSettings(settings), anchor };
}

export function chartRule(
  chart: { settings: ChartSettings; source: GridRange; anchor: GridAnchor },
  rows: Axis,
  columns: Axis,
): { ranges: IdRange[]; body: StoredChart } | undefined {
  const source = anchorRange({ ...chart.source, rangeType: 0 }, rows, columns);
  const anchor = anchorChart(chart.anchor, rows, columns);
  if (source === undefined || anchor === undefined) {
    return undefined;
  }
  return { ranges: [source], body: chartRuleBody(chart.settings, anchor) };
}

export function writeChart(
  sheet: SheetMap,
  id: string,
  chart: { settings: ChartSettings; source: GridRange; anchor: GridAnchor },
  origin?: unknown,
): void {
  const anchored = chartRule(chart, readAxis(sheet, 'rows'), readAxis(sheet, 'columns'));
  if (anchored === undefined) {
    return;
  }
  writeRule(sheet, { id, feature: CHART_FEATURE, ranges: [chart.source], body: anchored.body }, origin);
}

export function readCharts(sheet: SheetMap): ResolvedChart[] {
  const rows = readAxis(sheet, 'rows');
  const columns = readAxis(sheet, 'columns');
  return readRules(sheet, CHART_FEATURE).flatMap((rule) => {
    const body = rule.body as Partial<StoredChart> | undefined;
    if (body === undefined || !isStoredAnchor(body.anchor)) {
      return [];
    }
    const anchor = resolveAnchor(body.anchor, rows, columns);
    const range = rule.ranges[0];
    if (anchor === undefined || range === undefined) {
      return [];
    }
    return [
      {
        id: rule.id,
        settings: normaliseSettings(body.settings),
        source: { startRow: range.startRow, endRow: range.endRow, startColumn: range.startColumn, endColumn: range.endColumn },
        anchor,
      },
    ];
  });
}

export type ChartValue = string | number | boolean | null;

interface ChartTable {
  categories: string[];
  series: { name: string; values: (number | null)[] }[];
}

function asNumber(value: ChartValue): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asLabel(value: ChartValue): string {
  return value === null ? '' : String(value);
}

export function chartTable(settings: ChartSettings, grid: ChartValue[][]): ChartTable {
  const width = Math.max(0, ...grid.map((row) => row.length));
  const square = grid.map((row) => Array.from({ length: width }, (_, column) => row[column] ?? null));
  const lines = settings.series === 'columns' ? square : Array.from({ length: width }, (_, column) => square.map((row) => row[column]));
  if (lines.length === 0 || lines[0].length === 0) {
    return { categories: [], series: [] };
  }
  const header = settings.headers ? lines[0] : undefined;
  const body = settings.headers ? lines.slice(1) : lines;
  const seriesCount = body[0]?.length ?? lines[0].length;
  const firstIsCategory =
    seriesCount > 1 && body.length > 0 && body.every((row) => row[0] === null || asNumber(row[0]) === null);
  const start = firstIsCategory ? 1 : 0;
  const categories = body.map((row, index) => (firstIsCategory ? asLabel(row[0]) : String(index + 1)));
  const series = [];
  for (let column = start; column < seriesCount && series.length < CHART_MAX_SERIES; column += 1) {
    series.push({
      name: header === undefined ? `Series ${series.length + 1}` : asLabel(header[column]) || `Series ${series.length + 1}`,
      values: body.map((row) => asNumber(row[column])),
    });
  }
  return { categories, series };
}

export function chartOption(settings: ChartSettings, grid: ChartValue[][]): Record<string, unknown> {
  const table = chartTable(settings, grid);
  const text = { color: CHART_INK.secondary, fontSize: 12 };
  const legend =
    table.series.length >= 2 || settings.kind === 'pie'
      ? { show: true, top: settings.title ? 28 : 4, textStyle: text, itemWidth: 12, itemHeight: 8 }
      : { show: false };
  const base = {
    color: [...CHART_PALETTE],
    backgroundColor: CHART_INK.surface,
    animation: false,
    title: settings.title ? { text: settings.title, left: 8, top: 4, textStyle: { color: CHART_INK.primary, fontSize: 14, fontWeight: 600 } } : undefined,
    legend,
    tooltip: { trigger: settings.kind === 'pie' || settings.kind === 'scatter' ? 'item' : 'axis', confine: true },
    textStyle: { fontFamily: 'Inter, system-ui, sans-serif' },
  };

  if (settings.kind === 'pie') {
    const first = table.series[0];
    return {
      ...base,
      series: [
        {
          type: 'pie',
          radius: ['0%', '68%'],
          center: ['50%', '58%'],
          itemStyle: { borderColor: CHART_INK.surface, borderWidth: 2 },
          label: { color: CHART_INK.secondary },
          data: (first?.values ?? []).map((value, index) => ({ name: table.categories[index], value: value ?? 0 })),
        },
      ],
    };
  }

  const plot = { left: 48, right: 16, bottom: 32, top: (settings.title ? 28 : 8) + (table.series.length >= 2 ? 24 : 0), containLabel: true };
  const valueAxis = {
    type: 'value',
    axisLabel: text,
    splitLine: { lineStyle: { color: CHART_INK.grid } },
    axisLine: { show: false },
  };
  const categoryAxis = {
    type: 'category',
    data: table.categories,
    axisLabel: text,
    axisLine: { lineStyle: { color: CHART_INK.grid } },
    axisTick: { show: false },
  };

  if (settings.kind === 'scatter') {
    const [x, ...ys] = table.series;
    return {
      ...base,
      grid: plot,
      xAxis: { ...valueAxis, name: x?.name, nameTextStyle: text },
      yAxis: valueAxis,
      series: ys.map((series) => ({
        type: 'scatter',
        name: series.name,
        symbolSize: 8,
        data: series.values.map((value, index) => [x?.values[index] ?? null, value]),
      })),
    };
  }

  const horizontal = settings.kind === 'bar';
  const bars = settings.kind === 'column' || settings.kind === 'bar';
  return {
    ...base,
    grid: plot,
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: table.series.map((series) =>
      bars
        ? {
            type: 'bar',
            name: series.name,
            data: series.values,
            barGap: '8%',
            itemStyle: { borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] },
          }
        : {
            type: 'line',
            name: series.name,
            data: series.values,
            showSymbol: false,
            lineStyle: { width: 2 },
            areaStyle: settings.kind === 'area' ? { opacity: 0.18 } : undefined,
            connectNulls: false,
          },
    ),
  };
}
