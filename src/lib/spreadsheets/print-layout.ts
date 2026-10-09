import { paperDimensions, pixelsFromMillimetres, type PageMargins } from '@/lib/document-page';
import type { ContentRect } from './chart-geometry';
import { MARGIN_PRESET_SIZES, type CellArea, type LineSpan, type PageSetup, type PrintSettings } from './print';

export const MAX_PRINT_PAGES = 250;
export const MIN_PRINT_SCALE = 0.1;
const FIT_TOLERANCE = 0.01;

export class PrintGrid {
  private readonly rowStarts: Float64Array;
  private readonly columnStarts: Float64Array;

  constructor(
    readonly rowSizes: readonly number[],
    readonly columnSizes: readonly number[],
  ) {
    this.rowStarts = cumulative(rowSizes);
    this.columnStarts = cumulative(columnSizes);
  }

  get rowCount(): number {
    return this.rowSizes.length;
  }

  get columnCount(): number {
    return this.columnSizes.length;
  }

  rowSize(row: number): number {
    return this.rowSizes[row] ?? 0;
  }

  columnSize(column: number): number {
    return this.columnSizes[column] ?? 0;
  }

  rowStart(row: number): number {
    return this.rowStarts[clampIndex(row, this.rowSizes.length)];
  }

  columnStart(column: number): number {
    return this.columnStarts[clampIndex(column, this.columnSizes.length)];
  }

  rowsSize(span: LineSpan): number {
    return this.rowStart(span.end + 1) - this.rowStart(span.start);
  }

  columnsSize(span: LineSpan): number {
    return this.columnStart(span.end + 1) - this.columnStart(span.start);
  }
}

function cumulative(sizes: readonly number[]): Float64Array {
  const starts = new Float64Array(sizes.length + 1);
  for (let index = 0; index < sizes.length; index += 1) {
    const size = sizes[index];
    starts[index + 1] = starts[index] + (Number.isFinite(size) && size > 0 ? size : 0);
  }
  return starts;
}

function clampIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length);
}

export interface PrintPage {
  rows: LineSpan;
  columns: LineSpan;
  titleRows?: LineSpan;
  titleColumns?: LineSpan;
}

export interface PrintLayout {
  paper: { width: number; height: number };
  margins: PageMargins;
  content: { width: number; height: number };
  scale: number;
  pages: PrintPage[];
  totalPages: number;
}

export function clampArea(area: CellArea, grid: PrintGrid): CellArea | undefined {
  const startRow = Math.max(0, area.startRow);
  const startColumn = Math.max(0, area.startColumn);
  const endRow = Math.min(grid.rowCount - 1, area.endRow);
  const endColumn = Math.min(grid.columnCount - 1, area.endColumn);
  return startRow > endRow || startColumn > endColumn ? undefined : { startRow, endRow, startColumn, endColumn };
}

function clampSpan(span: LineSpan | undefined, count: number): LineSpan | undefined {
  if (span === undefined) {
    return undefined;
  }
  const start = Math.max(0, span.start);
  const end = Math.min(count - 1, span.end);
  return start > end ? undefined : { start, end };
}

function repeats(titles: LineSpan | undefined, bodyStart: number, size: number): titles is LineSpan {
  return titles !== undefined && size > 0 && titles.end < bodyStart;
}

function chunk(
  sizes: (index: number) => number,
  span: LineSpan,
  breaks: ReadonlySet<number>,
  available: (start: number) => number,
): LineSpan[] {
  const chunks: LineSpan[] = [];
  let start = span.start;
  let used = sizes(span.start);
  for (let index = span.start + 1; index <= span.end; index += 1) {
    const size = sizes(index);
    if (breaks.has(index) || (size > 0 && used + size > available(start) + FIT_TOLERANCE)) {
      chunks.push({ start, end: index - 1 });
      start = index;
      used = size;
    } else {
      used += size;
    }
  }
  chunks.push({ start, end: span.end });
  return chunks;
}

function fitScale(setup: PageSetup, content: { width: number; height: number }, width: number, height: number): number {
  if (setup.scale === 'actual') {
    return 1;
  }
  const byWidth = width > 0 ? content.width / width : 1;
  const byHeight = height > 0 ? content.height / height : 1;
  const scale = setup.scale === 'width' ? byWidth : Math.min(byWidth, byHeight);
  return Math.max(MIN_PRINT_SCALE, Math.min(1, Math.floor(scale * 10000) / 10000));
}

export function layoutPrint(
  grid: PrintGrid,
  requestedArea: CellArea,
  settings: Omit<PrintSettings, 'area'>,
  setup: PageSetup,
): PrintLayout {
  const paper = paperDimensions(setup.paper, setup.orientation);
  const margins = MARGIN_PRESET_SIZES[setup.margins];
  const content = {
    width: pixelsFromMillimetres(paper.width - margins.left - margins.right),
    height: pixelsFromMillimetres(paper.height - margins.top - margins.bottom),
  };
  const area = clampArea(requestedArea, grid);
  if (area === undefined) {
    return { paper, margins, content, scale: 1, pages: [], totalPages: 0 };
  }

  const rowSpan = { start: area.startRow, end: area.endRow };
  const columnSpan = { start: area.startColumn, end: area.endColumn };
  const titleRows = clampSpan(settings.titleRows, grid.rowCount);
  const titleColumns = clampSpan(settings.titleColumns, grid.columnCount);
  const titleRowsSize = titleRows === undefined ? 0 : grid.rowsSize(titleRows);
  const titleColumnsSize = titleColumns === undefined ? 0 : grid.columnsSize(titleColumns);

  const scale = fitScale(
    setup,
    content,
    grid.columnsSize(columnSpan) + (repeats(titleColumns, columnSpan.start, titleColumnsSize) ? titleColumnsSize : 0),
    grid.rowsSize(rowSpan) + (repeats(titleRows, rowSpan.start, titleRowsSize) ? titleRowsSize : 0),
  );

  const noBreaks = new Set<number>();
  const rowBreaks = setup.scale === 'page' ? noBreaks : new Set(settings.rowBreaks);
  const columnBreaks = setup.scale === 'actual' ? new Set(settings.columnBreaks) : noBreaks;

  const rowChunks = chunk(
    (row) => grid.rowSize(row),
    rowSpan,
    rowBreaks,
    (start) => content.height / scale - (repeats(titleRows, start, titleRowsSize) ? titleRowsSize : 0),
  );
  const columnChunks = chunk(
    (column) => grid.columnSize(column),
    columnSpan,
    columnBreaks,
    (start) => content.width / scale - (repeats(titleColumns, start, titleColumnsSize) ? titleColumnsSize : 0),
  );

  const totalPages = rowChunks.length * columnChunks.length;
  const pages: PrintPage[] = [];
  const outer = setup.order === 'down' ? columnChunks : rowChunks;
  const inner = setup.order === 'down' ? rowChunks : columnChunks;
  for (const first of outer) {
    for (const second of inner) {
      if (pages.length >= MAX_PRINT_PAGES) {
        break;
      }
      const rows = setup.order === 'down' ? second : first;
      const columns = setup.order === 'down' ? first : second;
      const page: PrintPage = { rows, columns };
      if (repeats(titleRows, rows.start, titleRowsSize)) {
        page.titleRows = titleRows;
      }
      if (repeats(titleColumns, columns.start, titleColumnsSize)) {
        page.titleColumns = titleColumns;
      }
      pages.push(page);
    }
  }

  return { paper, margins, content, scale, pages, totalPages };
}

export type RegionKind = 'corner' | 'top' | 'left' | 'body';

export interface PageRegion {
  kind: RegionKind;
  rows: LineSpan;
  columns: LineSpan;
  left: number;
  top: number;
  width: number;
  height: number;
}

export function pageRegions(grid: PrintGrid, page: PrintPage): PageRegion[] {
  const titleWidth = page.titleColumns === undefined ? 0 : grid.columnsSize(page.titleColumns);
  const titleHeight = page.titleRows === undefined ? 0 : grid.rowsSize(page.titleRows);
  const bodyWidth = grid.columnsSize(page.columns);
  const bodyHeight = grid.rowsSize(page.rows);
  const regions: PageRegion[] = [];
  if (page.titleRows !== undefined && page.titleColumns !== undefined) {
    regions.push({ kind: 'corner', rows: page.titleRows, columns: page.titleColumns, left: 0, top: 0, width: titleWidth, height: titleHeight });
  }
  if (page.titleRows !== undefined) {
    regions.push({ kind: 'top', rows: page.titleRows, columns: page.columns, left: titleWidth, top: 0, width: bodyWidth, height: titleHeight });
  }
  if (page.titleColumns !== undefined) {
    regions.push({ kind: 'left', rows: page.rows, columns: page.titleColumns, left: 0, top: titleHeight, width: titleWidth, height: bodyHeight });
  }
  regions.push({ kind: 'body', rows: page.rows, columns: page.columns, left: titleWidth, top: titleHeight, width: bodyWidth, height: bodyHeight });
  return regions;
}

export type HorizontalPlacement = 'left' | 'center' | 'right' | 'justify';

export interface PrintCell {
  text: string;
  numeric: boolean;
  horizontal: HorizontalPlacement;
  wrap: boolean;
  decorated: boolean;
}

export interface PlacedCell<C extends PrintCell = PrintCell> {
  row: number;
  column: number;
  cell: C;
  box: ContentRect;
  text: ContentRect;
}

export function regionCells<C extends PrintCell>(
  grid: PrintGrid,
  region: PageRegion,
  cellAt: (row: number, column: number) => C | undefined,
  merges: readonly CellArea[],
): PlacedCell<C>[] {
  const originX = grid.columnStart(region.columns.start);
  const originY = grid.rowStart(region.rows.start);
  const rect = (area: CellArea): ContentRect => ({
    left: grid.columnStart(area.startColumn) - originX,
    top: grid.rowStart(area.startRow) - originY,
    width: grid.columnStart(area.endColumn + 1) - grid.columnStart(area.startColumn),
    height: grid.rowStart(area.endRow + 1) - grid.rowStart(area.startRow),
  });

  const covered = new Set<string>();
  const placed: PlacedCell<C>[] = [];
  for (const merge of merges) {
    if (
      merge.endRow < region.rows.start ||
      merge.startRow > region.rows.end ||
      merge.endColumn < region.columns.start ||
      merge.startColumn > region.columns.end
    ) {
      continue;
    }
    for (let row = Math.max(merge.startRow, region.rows.start); row <= Math.min(merge.endRow, region.rows.end); row += 1) {
      for (
        let column = Math.max(merge.startColumn, region.columns.start);
        column <= Math.min(merge.endColumn, region.columns.end);
        column += 1
      ) {
        covered.add(`${row}:${column}`);
      }
    }
    const cell = cellAt(merge.startRow, merge.startColumn);
    const box = rect(merge);
    if (cell !== undefined && box.width > 0 && box.height > 0) {
      placed.push({ row: merge.startRow, column: merge.startColumn, cell, box, text: box });
    }
  }

  const isFree = (row: number, column: number) => !covered.has(`${row}:${column}`) && !(cellAt(row, column)?.text);

  for (let row = region.rows.start; row <= region.rows.end; row += 1) {
    if (grid.rowSize(row) <= 0) {
      continue;
    }
    for (let column = region.columns.start; column <= region.columns.end; column += 1) {
      if (grid.columnSize(column) <= 0 || covered.has(`${row}:${column}`)) {
        continue;
      }
      const cell = cellAt(row, column);
      if (cell === undefined) {
        continue;
      }
      const box = rect({ startRow: row, endRow: row, startColumn: column, endColumn: column });
      placed.push({ row, column, cell, box, text: overflowBox(grid, region, row, column, cell, box, isFree) });
    }
  }
  return placed;
}

function overflowBox(
  grid: PrintGrid,
  region: PageRegion,
  row: number,
  column: number,
  cell: PrintCell,
  box: ContentRect,
  isFree: (row: number, column: number) => boolean,
): ContentRect {
  if (cell.wrap || cell.numeric || cell.text === '' || cell.horizontal === 'justify') {
    return box;
  }
  const reach = (direction: 1 | -1) => {
    let distance = 0;
    for (
      let next = column + direction;
      next >= region.columns.start && next <= region.columns.end;
      next += direction
    ) {
      if (!isFree(row, next)) {
        break;
      }
      distance += grid.columnSize(next);
    }
    return distance;
  };
  if (cell.horizontal === 'left') {
    return { ...box, width: box.width + reach(1) };
  }
  if (cell.horizontal === 'right') {
    const left = reach(-1);
    return { ...box, left: box.left - left, width: box.width + left };
  }
  const spread = Math.min(reach(-1), reach(1));
  return { ...box, left: box.left - spread, width: box.width + spread * 2 };
}

export function regionGridlines(grid: PrintGrid, region: PageRegion): { xs: number[]; ys: number[] } {
  const originX = grid.columnStart(region.columns.start);
  const originY = grid.rowStart(region.rows.start);
  const xs = [0];
  const ys = [0];
  for (let column = region.columns.start; column <= region.columns.end; column += 1) {
    if (grid.columnSize(column) > 0) {
      xs.push(grid.columnStart(column + 1) - originX);
    }
  }
  for (let row = region.rows.start; row <= region.rows.end; row += 1) {
    if (grid.rowSize(row) > 0) {
      ys.push(grid.rowStart(row + 1) - originY);
    }
  }
  return { xs, ys };
}

export function regionCharts<T extends { rect: ContentRect }>(
  grid: PrintGrid,
  region: PageRegion,
  charts: readonly T[],
): (T & { box: ContentRect })[] {
  const originX = grid.columnStart(region.columns.start);
  const originY = grid.rowStart(region.rows.start);
  return charts
    .map((chart) => ({
      ...chart,
      box: { ...chart.rect, left: chart.rect.left - originX, top: chart.rect.top - originY },
    }))
    .filter(
      ({ box }) =>
        box.width > 0 &&
        box.height > 0 &&
        box.left < region.width &&
        box.top < region.height &&
        box.left + box.width > 0 &&
        box.top + box.height > 0,
    );
}

export function regionMerges(grid: PrintGrid, region: PageRegion, merges: readonly CellArea[]): ContentRect[] {
  const originX = grid.columnStart(region.columns.start);
  const originY = grid.rowStart(region.rows.start);
  return merges
    .filter(
      (merge) =>
        merge.endRow >= region.rows.start &&
        merge.startRow <= region.rows.end &&
        merge.endColumn >= region.columns.start &&
        merge.startColumn <= region.columns.end,
    )
    .map((merge) => ({
      left: grid.columnStart(merge.startColumn) - originX,
      top: grid.rowStart(merge.startRow) - originY,
      width: grid.columnStart(merge.endColumn + 1) - grid.columnStart(merge.startColumn),
      height: grid.rowStart(merge.endRow + 1) - grid.rowStart(merge.startRow),
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

export function lineEnds(sizes: readonly number[]): number[] {
  const ends: number[] = [];
  let total = 0;
  for (const size of sizes) {
    total += Number.isFinite(size) && size > 0 ? size : 0;
    ends.push(total);
  }
  return ends;
}

export function contentArea(
  cells: Iterable<{ row: number; column: number }>,
  extents: readonly CellArea[],
): CellArea | undefined {
  let area: CellArea | undefined;
  const include = (startRow: number, startColumn: number, endRow: number, endColumn: number) => {
    area =
      area === undefined
        ? { startRow, startColumn, endRow, endColumn }
        : {
            startRow: Math.min(area.startRow, startRow),
            startColumn: Math.min(area.startColumn, startColumn),
            endRow: Math.max(area.endRow, endRow),
            endColumn: Math.max(area.endColumn, endColumn),
          };
  };
  for (const { row, column } of cells) {
    include(row, column, row, column);
  }
  for (const extent of extents) {
    include(extent.startRow, extent.startColumn, extent.endRow, extent.endColumn);
  }
  return area === undefined ? undefined : { ...area, startRow: 0, startColumn: 0 };
}
