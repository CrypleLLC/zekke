import type { IRange, IWorksheetData, Worksheet } from '@univerjs/core';
import {
  SHEET_DEFAULT_STYLE,
  SHEET_FREEZE,
  SHEET_GRIDLINES,
  SHEET_GRIDLINES_COLOR,
  SHEET_HIDDEN,
  SHEET_NAME,
  SHEET_RIGHT_TO_LEFT,
  SHEET_TAB_COLOR,
  SharedFormulaError,
  anchorRange,
  encodeContent,
  type CellData,
  type Dimension,
  type FormulaCodec,
  type IdRange,
  type LineProperties,
  type Operation,
  type WorkbookIndex,
  Axis,
} from '@/lib/spreadsheets';
import type { WorkbookMirror } from './mirror';
import type { UniverSurface } from './surface';

export interface CaptureContext {
  surface: UniverSurface;
  mirror: WorkbookMirror;
  codec: FormulaCodec;
  knownIds: (sheetId: string, dimension: Dimension) => ReadonlySet<string>;
}

export type CaptureResult = { operations: Operation[] } | { ignored: true } | { unbound: true };

const IGNORED = new Set([
  'sheet.mutation.set-worksheet-row-auto-height',
  'sheet.mutation.empty',
  'sheet.mutation.copy-worksheet-end',
  'sheet.mutation.mark-dirty-filter-change',
]);

interface SheetPropertyReader {
  key: string;
  read: (config: IWorksheetData) => unknown;
}

const SHEET_PROPERTY_MUTATIONS: Record<string, SheetPropertyReader> = {
  'sheet.mutation.set-frozen': { key: SHEET_FREEZE, read: (config) => freezeOf(config) },
  'sheet.mutation.set-worksheet-name': { key: SHEET_NAME, read: (config) => config.name },
  'sheet.mutation.set-worksheet-hidden': { key: SHEET_HIDDEN, read: (config) => (config.hidden ? config.hidden : undefined) },
  'sheet.mutation.set-tab-color': { key: SHEET_TAB_COLOR, read: (config) => (config.tabColor ? config.tabColor : undefined) },
  'sheet.mutation.toggle-gridlines': { key: SHEET_GRIDLINES, read: (config) => config.showGridlines },
  'sheet.mutation.set-gridlines-color': { key: SHEET_GRIDLINES_COLOR, read: (config) => config.gridlinesColor || undefined },
  'sheet.mutation.set-worksheet-right-to-left': {
    key: SHEET_RIGHT_TO_LEFT,
    read: (config) => (config.rightToLeft ? config.rightToLeft : undefined),
  },
};

function freezeOf(config: IWorksheetData): IWorksheetData['freeze'] | undefined {
  const freeze = config.freeze;
  if (freeze === undefined || (freeze.xSplit === 0 && freeze.ySplit === 0)) {
    return undefined;
  }
  return { xSplit: freeze.xSplit, ySplit: freeze.ySplit, startRow: freeze.startRow, startColumn: freeze.startColumn };
}

function span(start: number, end: number, size: number): number[] {
  const from = Math.max(0, Number.isFinite(start) ? start : 0);
  const to = Math.min(size - 1, Number.isFinite(end) ? end : size - 1);
  const indexes: number[] = [];
  for (let index = from; index <= to; index += 1) {
    indexes.push(index);
  }
  return indexes;
}

export class MutationCapture {
  private workbookIndex: WorkbookIndex | undefined;

  constructor(private readonly context: CaptureContext) {}

  capture(id: string, params: Record<string, unknown>): CaptureResult {
    this.workbookIndex = undefined;
    if (IGNORED.has(id)) {
      return { ignored: true };
    }
    if (typeof params.unitId === 'string' && params.unitId !== this.context.surface.unitId) {
      return { ignored: true };
    }
    const operations = this.translate(id, params);
    return operations === undefined ? { unbound: true } : { operations };
  }

  private index(): WorkbookIndex {
    this.workbookIndex ??= this.context.mirror.index();
    return this.workbookIndex;
  }

  private translate(id: string, params: Record<string, unknown>): Operation[] | undefined {
    const sheetId = params.subUnitId as string | undefined;
    const range = params.range as IRange | undefined;

    switch (id) {
      case 'sheet.mutation.set-range-values':
        return this.cellsAt(sheetId, Object.entries((params.cellValue ?? {}) as Record<string, Record<string, unknown>>).flatMap(
          ([row, columns]) => Object.keys(columns ?? {}).map((column) => [Number(row), Number(column)] as const),
        ));
      case 'sheet.mutation.move-range': {
        const from = params.from as { subUnitId: string };
        const to = params.to as { subUnitId: string };
        return [
          ...this.cellsInRanges(from.subUnitId, [params.fromRange as IRange]),
          ...this.cellsInRanges(to.subUnitId, [params.toRange as IRange]),
        ];
      }
      case 'sheet.mutation.reorder-range':
        return this.cellsInRanges(sheetId, range === undefined ? [] : [range]);
      case 'sheet.mutation.set.numfmt':
        return this.cellsInRanges(
          sheetId,
          Object.values((params.values ?? {}) as Record<string, { ranges: IRange[] }>).flatMap((value) => value.ranges),
        );
      case 'sheet.mutation.remove.numfmt':
        return this.cellsInRanges(sheetId, (params.ranges ?? []) as IRange[]);

      case 'sheet.mutation.insert-row':
        return this.insertLines(sheetId, 'rows', range!.startRow, range!.endRow - range!.startRow + 1);
      case 'sheet.mutation.insert-col':
        return this.insertLines(sheetId, 'columns', range!.startColumn, range!.endColumn - range!.startColumn + 1);
      case 'sheet.mutation.remove-rows':
        return this.removeLines(sheetId, 'rows', range!.startRow, range!.endRow - range!.startRow + 1);
      case 'sheet.mutation.remove-col':
        return this.removeLines(sheetId, 'columns', range!.startColumn, range!.endColumn - range!.startColumn + 1);
      case 'sheet.mutation.move-rows':
        return this.moveLines(sheetId, 'rows', params.sourceRange as IRange, params.targetRange as IRange);
      case 'sheet.mutation.move-columns':
        return this.moveLines(sheetId, 'columns', params.sourceRange as IRange, params.targetRange as IRange);
      case 'sheet.mutation.set-worksheet-row-count':
        return this.resize(sheetId, 'rows', params.rowCount as number);
      case 'sheet.mutation.set-worksheet-column-count':
        return this.resize(sheetId, 'columns', params.columnCount as number);

      case 'sheet.mutation.set-worksheet-row-height':
      case 'sheet.mutation.set-worksheet-row-is-auto-height':
      case 'sheet.mutation.set-row-hidden':
      case 'sheet.mutation.set-row-visible':
        return this.linesInRanges(sheetId, 'rows', (params.ranges ?? []) as IRange[]);
      case 'sheet.mutation.set-worksheet-col-width':
      case 'sheet.mutation.set-col-hidden':
      case 'sheet.mutation.set-col-visible':
        return this.linesInRanges(sheetId, 'columns', (params.ranges ?? []) as IRange[]);
      case 'sheet.mutation.set-row-data':
        return this.lines(sheetId, 'rows', Object.keys((params.rowData ?? {}) as object).map(Number));
      case 'sheet.mutation.set-col-data':
        return this.lines(sheetId, 'columns', Object.keys((params.columnData ?? {}) as object).map(Number));

      case 'sheet.mutation.add-worksheet-merge':
      case 'sheet.mutation.remove-worksheet-merge':
        return this.merges(sheetId);

      case 'sheet.mutation.set-worksheet-default-style':
        return this.sheetProperty(sheetId, SHEET_DEFAULT_STYLE, (config) =>
          this.context.surface.styleData(config.defaultStyle),
        );

      case 'sheet.mutation.insert-sheet':
        return this.insertSheet((params.sheet as IWorksheetData).id, params.index as number);
      case 'sheet.mutation.remove-sheet':
        return this.removeSheet(sheetId);
      case 'sheet.mutation.set-worksheet-order':
        return this.moveSheet(sheetId, params.toOrder as number);
      case 'sheet.mutation.set-workbook-name':
        return [{ kind: 'title', title: String(params.name ?? '') }];

      case 'formula.mutation.set-defined-name':
        return this.definedName(params.id as string);
      case 'formula.mutation.remove-defined-name':
        return [{ kind: 'name', id: params.id as string }];
    }

    const property = SHEET_PROPERTY_MUTATIONS[id];
    if (property !== undefined) {
      return this.sheetProperty(sheetId, property.key, property.read);
    }
    return undefined;
  }

  private worksheet(sheetId: string | undefined): Worksheet | undefined {
    return sheetId === undefined ? undefined : this.context.surface.worksheet(sheetId);
  }

  cellOperation(sheetId: string, row: number, column: number): Operation | undefined {
    const mirror = this.context.mirror.sheet(sheetId);
    const rowId = mirror?.rows[row];
    const columnId = mirror?.columns[column];
    if (rowId === undefined || columnId === undefined) {
      return undefined;
    }
    const surface = this.context.surface;
    const raw = surface.rawCell(sheetId, row, column);
    const formula = surface.cellFormula(sheetId, row, column, raw);
    let content;
    try {
      content = encodeContent({ ...raw, f: formula ?? null, si: null } as CellData, (text) =>
        this.context.codec.store(text, { sheetId, row, column, workbook: this.index() }),
      );
    } catch (error) {
      if (error instanceof SharedFormulaError) {
        return undefined;
      }
      throw error;
    }
    return { kind: 'cell', sheetId, rowId, columnId, content, style: surface.styleData(raw.s) };
  }

  private cellsAt(sheetId: string | undefined, cells: readonly (readonly [number, number])[]): Operation[] {
    if (sheetId === undefined) {
      return [];
    }
    return cells.flatMap(([row, column]) => this.cellOperation(sheetId, row, column) ?? []);
  }

  private cellsInRanges(sheetId: string | undefined, ranges: readonly IRange[]): Operation[] {
    const mirror = sheetId === undefined ? undefined : this.context.mirror.sheet(sheetId);
    if (sheetId === undefined || mirror === undefined) {
      return [];
    }
    const cells: [number, number][] = [];
    for (const range of ranges) {
      for (const row of span(range.startRow, range.endRow, mirror.rows.length)) {
        for (const column of span(range.startColumn, range.endColumn, mirror.columns.length)) {
          cells.push([row, column]);
        }
      }
    }
    return this.cellsAt(sheetId, cells);
  }

  lineOperation(sheetId: string, dimension: Dimension, index: number): Operation | undefined {
    const id = this.context.mirror.sheet(sheetId)?.[dimension][index];
    const worksheet = this.worksheet(sheetId);
    if (id === undefined || worksheet === undefined) {
      return undefined;
    }
    const surface = this.context.surface;
    const properties: LineProperties = {};
    if (dimension === 'rows') {
      const row = worksheet.getRowManager().getRow(index);
      if (typeof row?.h === 'number') {
        properties.size = row.h;
      }
      if (row?.hd === 1) {
        properties.hidden = true;
      }
      if (row?.ia === 0) {
        properties.manualSize = true;
      }
      properties.style = surface.styleData(row?.s);
    } else {
      const column = worksheet.getColumnManager().getColumn(index);
      if (typeof column?.w === 'number') {
        properties.size = column.w;
      }
      if (column?.hd === 1) {
        properties.hidden = true;
      }
      properties.style = surface.styleData(column?.s);
    }
    return { kind: 'line', sheetId, dimension, id, properties };
  }

  private lines(sheetId: string | undefined, dimension: Dimension, indexes: readonly number[]): Operation[] {
    if (sheetId === undefined) {
      return [];
    }
    return indexes.flatMap((index) => this.lineOperation(sheetId, dimension, index) ?? []);
  }

  private linesInRanges(sheetId: string | undefined, dimension: Dimension, ranges: readonly IRange[]): Operation[] {
    const mirror = sheetId === undefined ? undefined : this.context.mirror.sheet(sheetId);
    if (mirror === undefined) {
      return [];
    }
    const size = mirror[dimension].length;
    return this.lines(
      sheetId,
      dimension,
      ranges.flatMap((range) =>
        dimension === 'rows' ? span(range.startRow, range.endRow, size) : span(range.startColumn, range.endColumn, size),
      ),
    );
  }

  private insertLines(sheetId: string | undefined, dimension: Dimension, index: number, count: number): Operation[] {
    const mirror = sheetId === undefined ? undefined : this.context.mirror.sheet(sheetId);
    if (sheetId === undefined || mirror === undefined || count <= 0) {
      return [];
    }
    const ids = this.context.mirror.freshLineIds(sheetId, dimension, count, this.context.knownIds(sheetId, dimension));
    const beforeId = mirror[dimension][index];
    mirror[dimension].splice(index, 0, ...ids);
    const operations: Operation[] = [{ kind: 'insert-lines', sheetId, dimension, ids, beforeId }];
    for (let offset = 0; offset < count; offset += 1) {
      const line = this.lineOperation(sheetId, dimension, index + offset);
      if (line !== undefined) {
        operations.push(line);
      }
    }
    return operations;
  }

  private removeLines(sheetId: string | undefined, dimension: Dimension, index: number, count: number): Operation[] {
    const mirror = sheetId === undefined ? undefined : this.context.mirror.sheet(sheetId);
    if (sheetId === undefined || mirror === undefined) {
      return [];
    }
    const ids = mirror[dimension].splice(index, count);
    return ids.length === 0 ? [] : [{ kind: 'remove-lines', sheetId, dimension, ids }];
  }

  private moveLines(sheetId: string | undefined, dimension: Dimension, source: IRange, target: IRange): Operation[] {
    const mirror = sheetId === undefined ? undefined : this.context.mirror.sheet(sheetId);
    if (sheetId === undefined || mirror === undefined) {
      return [];
    }
    const start = dimension === 'rows' ? source.startRow : source.startColumn;
    const end = dimension === 'rows' ? source.endRow : source.endColumn;
    const to = dimension === 'rows' ? target.startRow : target.startColumn;
    const order = mirror[dimension];
    const ids = order.slice(start, end + 1);
    if (ids.length === 0 || (to >= start && to <= end + 1)) {
      return [];
    }
    const beforeId = order[to];
    const remaining = order.filter((id) => !ids.includes(id));
    const insertAt = beforeId === undefined ? remaining.length : remaining.indexOf(beforeId);
    remaining.splice(insertAt, 0, ...ids);
    order.splice(0, order.length, ...remaining);
    return [{ kind: 'move-lines', sheetId, dimension, ids, beforeId }];
  }

  private resize(sheetId: string | undefined, dimension: Dimension, count: number): Operation[] {
    const mirror = sheetId === undefined ? undefined : this.context.mirror.sheet(sheetId);
    if (mirror === undefined || !Number.isFinite(count)) {
      return [];
    }
    const current = mirror[dimension].length;
    if (count > current) {
      return this.insertLines(sheetId, dimension, current, count - current);
    }
    if (count < current) {
      return this.removeLines(sheetId, dimension, count, current - count);
    }
    return [];
  }

  private merges(sheetId: string | undefined): Operation[] {
    const worksheet = this.worksheet(sheetId);
    const mirror = sheetId === undefined ? undefined : this.context.mirror.sheet(sheetId);
    if (sheetId === undefined || worksheet === undefined || mirror === undefined) {
      return [];
    }
    const rows = new Axis(mirror.rows, new Set());
    const columns = new Axis(mirror.columns, new Set());
    const merges = worksheet
      .getMergeData()
      .map((range) => anchorRange({ ...range, rangeType: 0 }, rows, columns))
      .filter((range): range is IdRange => range !== undefined);
    return [{ kind: 'merges', sheetId, merges }];
  }

  private sheetProperty(
    sheetId: string | undefined,
    key: string,
    read: (config: IWorksheetData) => unknown,
  ): Operation[] {
    const worksheet = this.worksheet(sheetId);
    if (sheetId === undefined || worksheet === undefined) {
      return [];
    }
    const config = worksheet.getConfig();
    const value = read(config);
    if (key === SHEET_NAME) {
      const mirror = this.context.mirror.sheet(sheetId);
      if (mirror !== undefined) {
        mirror.name = String(value);
      }
    }
    return [{ kind: 'sheet-property', sheetId, key, value: value === undefined ? undefined : JSON.parse(JSON.stringify(value)) }];
  }

  private insertSheet(sheetId: string, index: number): Operation[] {
    const worksheet = this.worksheet(sheetId);
    if (worksheet === undefined || this.context.mirror.sheets.has(sheetId)) {
      return [];
    }
    const mirror = this.context.mirror;
    const rows = mirror.freshLineIds(sheetId, 'rows', worksheet.getRowCount(), new Set());
    const columns = mirror.freshLineIds(sheetId, 'columns', worksheet.getColumnCount(), new Set());
    mirror.sheets.set(sheetId, { name: worksheet.getName(), rows, columns });
    mirror.order.splice(Math.min(Math.max(0, index), mirror.order.length), 0, sheetId);
    this.workbookIndex = undefined;

    const operations: Operation[] = [
      { kind: 'insert-sheet', sheetId, name: worksheet.getName(), index, rowIds: rows, columnIds: columns },
    ];
    worksheet.getCellMatrix().forValue((row, column) => {
      const cell = this.cellOperation(sheetId, row, column);
      if (cell !== undefined) {
        operations.push(cell);
      }
    });
    rows.forEach((_, row) => {
      const line = this.lineOperation(sheetId, 'rows', row);
      if (line !== undefined && hasProperties(line)) {
        operations.push(line);
      }
    });
    columns.forEach((_, column) => {
      const line = this.lineOperation(sheetId, 'columns', column);
      if (line !== undefined && hasProperties(line)) {
        operations.push(line);
      }
    });
    operations.push(...this.merges(sheetId));
    for (const { key, read } of Object.values(SHEET_PROPERTY_MUTATIONS)) {
      const value = read(worksheet.getConfig());
      if (value !== undefined && key !== SHEET_NAME) {
        operations.push({ kind: 'sheet-property', sheetId, key, value: JSON.parse(JSON.stringify(value)) });
      }
    }
    return operations;
  }

  private removeSheet(sheetId: string | undefined): Operation[] {
    if (sheetId === undefined) {
      return [];
    }
    const mirror = this.context.mirror;
    mirror.sheets.delete(sheetId);
    const position = mirror.order.indexOf(sheetId);
    if (position !== -1) {
      mirror.order.splice(position, 1);
    }
    return [{ kind: 'remove-sheet', sheetId }];
  }

  private moveSheet(sheetId: string | undefined, toIndex: number): Operation[] {
    if (sheetId === undefined) {
      return [];
    }
    const order = this.context.mirror.order;
    const from = order.indexOf(sheetId);
    if (from === -1) {
      return [];
    }
    order.splice(from, 1);
    order.splice(Math.min(Math.max(0, toIndex), order.length), 0, sheetId);
    return [{ kind: 'move-sheet', sheetId, index: toIndex }];
  }

  definedName(id: string): Operation[] {
    const definition = this.context.surface.definedName(id);
    if (definition === undefined) {
      return [{ kind: 'name', id }];
    }
    const scopeSheet = definition.localSheetId && this.context.mirror.sheets.has(definition.localSheetId)
      ? definition.localSheetId
      : this.context.mirror.order[0];
    const formula =
      scopeSheet === undefined
        ? definition.formulaOrRefString
        : this.context.codec.store(definition.formulaOrRefString, {
            sheetId: scopeSheet,
            row: 0,
            column: 0,
            workbook: this.index(),
          });
    return [
      {
        kind: 'name',
        id,
        name: {
          name: definition.name,
          formula,
          sheetId: definition.localSheetId || undefined,
          comment: definition.comment,
          hidden: definition.hidden,
        },
      },
    ];
  }
}

function hasProperties(operation: Operation): boolean {
  if (operation.kind !== 'line') {
    return false;
  }
  const { size, hidden, manualSize, style } = operation.properties;
  return size !== undefined || hidden === true || manualSize === true || style !== undefined;
}
