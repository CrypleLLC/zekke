import type { ICellData, IStyleData, IWorkbookData, IWorksheetData, LocaleType } from '@univerjs/core';
import * as Y from 'yjs';
import { Axis, line, readAxis } from './axis';
import { decodeContent, encodeContent, forEachCell, writeCellStyleId, writeContent, type CellData } from './cells';
import { expandSharedFormulas } from './formulas';
import {
  LINE_AUTO_SIZE,
  LINE_HIDDEN,
  LINE_SIZE,
  LINE_STYLE,
  SHEET_DEFAULT_COLUMN_WIDTH,
  SHEET_DEFAULT_ROW_HEIGHT,
  SHEET_FREEZE,
  SHEET_DEFAULT_STYLE,
  SHEET_GRIDLINES,
  SHEET_GRIDLINES_COLOR,
  SHEET_HIDDEN,
  SHEET_RIGHT_TO_LEFT,
  SHEET_TAB_COLOR,
  markSpreadsheet,
  type Dimension,
  type SheetMap,
} from './layout';
import { RANGE_TYPE_NORMAL } from './ranges';
import { addMerge, readMerges } from './rules';
import { createSheet, readSheetName, readSheets, writeSheetProperty } from './sheets';
import { internStyle, readStyle, type StyleData } from './styles';

export interface SheetAxes {
  rows: Axis;
  columns: Axis;
}

export interface SheetIndexEntry {
  id: string;
  name: string;
  rows: Axis;
  columns: Axis;
}

export class WorkbookIndex {
  private readonly axes = new Map<string, SheetAxes>();
  private readonly names = new Map<string, string>();
  private readonly order: string[] = [];

  constructor(source: Y.Doc | readonly SheetIndexEntry[]) {
    const entries =
      source instanceof Y.Doc
        ? readSheets(source).map(({ id, sheet }) => ({
            id,
            name: readSheetName(sheet),
            rows: readAxis(sheet, 'rows'),
            columns: readAxis(sheet, 'columns'),
          }))
        : source;
    for (const { id, name, rows, columns } of entries) {
      this.order.push(id);
      this.axes.set(id, { rows, columns });
      this.names.set(id, name);
    }
  }

  sheetIds(): readonly string[] {
    return this.order;
  }

  sheetAxes(sheetId: string): SheetAxes | undefined {
    return this.axes.get(sheetId);
  }

  sheetName(sheetId: string): string | undefined {
    return this.names.get(sheetId);
  }

  sheetIdByName(name: string): string | undefined {
    const wanted = name.toLocaleLowerCase();
    for (const [id, sheetName] of this.names) {
      if (sheetName.toLocaleLowerCase() === wanted) {
        return id;
      }
    }
    return undefined;
  }
}

export interface FormulaScope {
  sheetId: string;
  row: number;
  column: number;
  workbook: WorkbookIndex;
}

export interface FormulaCodec {
  store(formula: string, scope: FormulaScope): string;
  display(stored: string, scope: FormulaScope): string;
}

export interface WorkbookIdentity {
  unitId: string;
  name: string;
  locale: LocaleType;
  appVersion: string;
}

function styleCollector(doc: Y.Doc, styles: Record<string, IStyleData>): (id: string | undefined) => string | undefined {
  return (id) => {
    if (id === undefined) {
      return undefined;
    }
    const style = readStyle(doc, id);
    if (style === undefined) {
      return undefined;
    }
    styles[id] = style as IStyleData;
    return id;
  };
}

export function toWorkbookData(doc: Y.Doc, identity: WorkbookIdentity, formulas: FormulaCodec): IWorkbookData {
  const workbook = new WorkbookIndex(doc);
  const styles: Record<string, IStyleData> = {};
  const sheets: IWorkbookData['sheets'] = {};
  const referenceStyle = styleCollector(doc, styles);

  for (const { id, sheet } of readSheets(doc)) {
    sheets[id] = toWorksheetData(id, sheet, workbook, formulas, referenceStyle);
  }

  return {
    id: identity.unitId,
    name: identity.name,
    appVersion: identity.appVersion,
    locale: identity.locale,
    styles,
    sheetOrder: [...workbook.sheetIds()],
    sheets,
  };
}

export function toSheetData(
  doc: Y.Doc,
  sheetId: string,
  formulas: FormulaCodec,
): { sheet: Partial<IWorksheetData>; styles: Record<string, IStyleData> } | undefined {
  const workbook = new WorkbookIndex(doc);
  const entry = readSheets(doc).find(({ id }) => id === sheetId);
  if (entry === undefined) {
    return undefined;
  }
  const styles: Record<string, IStyleData> = {};
  const sheet = toWorksheetData(sheetId, entry.sheet, workbook, formulas, styleCollector(doc, styles));
  return { sheet, styles };
}

function toWorksheetData(
  sheetId: string,
  sheet: SheetMap,
  workbook: WorkbookIndex,
  formulas: FormulaCodec,
  referenceStyle: (id: string | undefined) => string | undefined,
): Partial<IWorksheetData> {
  const { rows, columns } = workbook.sheetAxes(sheetId) as SheetAxes;
  const cellData: Record<number, Record<number, ICellData>> = {};
  const rowData: Record<number, Record<string, unknown>> = {};
  const columnData: Record<number, Record<string, unknown>> = {};

  rows.ids.forEach((rowId, row) => {
    forEachCell(sheet, rowId, (columnId, content, styleId) => {
      const column = columns.indexOf(columnId);
      if (column === undefined) {
        return;
      }
      const cell: CellData =
        content === undefined
          ? {}
          : decodeContent(content, (stored) => formulas.display(stored, { sheetId, row, column, workbook }));
      const style = referenceStyle(styleId);
      if (style !== undefined) {
        cell.s = style;
      }
      if (Object.keys(cell).length > 0) {
        (cellData[row] ??= {})[column] = cell as ICellData;
      }
    });
    const properties = lineProperties(sheet, 'rows', rowId, referenceStyle);
    if (properties !== undefined) {
      rowData[row] = properties;
    }
  });

  columns.ids.forEach((columnId, column) => {
    const properties = lineProperties(sheet, 'columns', columnId, referenceStyle);
    if (properties !== undefined) {
      columnData[column] = properties;
    }
  });

  const data: Partial<IWorksheetData> = {
    id: sheetId,
    name: readSheetName(sheet),
    rowCount: rows.size,
    columnCount: columns.size,
    cellData,
    rowData,
    columnData,
    mergeData: readMerges(sheet).map(({ range }) => ({
      startRow: range.startRow,
      endRow: range.endRow,
      startColumn: range.startColumn,
      endColumn: range.endColumn,
      rangeType: RANGE_TYPE_NORMAL,
    })),
  };

  copyProperty(sheet, SHEET_HIDDEN, (value) => (data.hidden = value as IWorksheetData['hidden']), 'number');
  copyProperty(sheet, SHEET_TAB_COLOR, (value) => (data.tabColor = value as string), 'string');
  copyProperty(sheet, SHEET_GRIDLINES, (value) => (data.showGridlines = value as IWorksheetData['showGridlines']), 'number');
  copyProperty(sheet, SHEET_RIGHT_TO_LEFT, (value) => (data.rightToLeft = value as IWorksheetData['rightToLeft']), 'number');
  copyProperty(sheet, SHEET_DEFAULT_ROW_HEIGHT, (value) => (data.defaultRowHeight = value as number), 'number');
  copyProperty(sheet, SHEET_DEFAULT_COLUMN_WIDTH, (value) => (data.defaultColumnWidth = value as number), 'number');
  copyProperty(sheet, SHEET_GRIDLINES_COLOR, (value) => (data.gridlinesColor = value as string), 'string');
  const freeze = sheet.get(SHEET_FREEZE);
  if (isFreeze(freeze)) {
    data.freeze = { ...freeze };
  }
  const defaultStyle = sheet.get(SHEET_DEFAULT_STYLE);
  if (typeof defaultStyle === 'object' && defaultStyle !== null) {
    data.defaultStyle = { ...(defaultStyle as IStyleData) };
  }

  return data;
}

function copyProperty(sheet: SheetMap, key: string, assign: (value: unknown) => void, type: 'string' | 'number'): void {
  const value = sheet.get(key);
  if (typeof value === type) {
    assign(value);
  }
}

function isFreeze(value: unknown): value is IWorksheetData['freeze'] {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const freeze = value as Record<string, unknown>;
  return ['xSplit', 'ySplit', 'startRow', 'startColumn'].every((key) => typeof freeze[key] === 'number');
}

function lineProperties(
  sheet: SheetMap,
  dimension: Dimension,
  id: string,
  referenceStyle: (id: string | undefined) => string | undefined,
): Record<string, unknown> | undefined {
  const entry = line(sheet, dimension, id);
  if (entry === undefined) {
    return undefined;
  }
  const properties: Record<string, unknown> = {};
  const size = entry.get(LINE_SIZE);
  if (typeof size === 'number') {
    properties[dimension === 'rows' ? 'h' : 'w'] = size;
  }
  if (entry.get(LINE_HIDDEN) === 1) {
    properties.hd = 1;
  }
  if (dimension === 'rows' && entry.get(LINE_AUTO_SIZE) === 0) {
    properties.ia = 0;
  }
  const style = referenceStyle(typeof entry.get(LINE_STYLE) === 'string' ? (entry.get(LINE_STYLE) as string) : undefined);
  if (style !== undefined) {
    properties.s = style;
  }
  return Object.keys(properties).length > 0 ? properties : undefined;
}

export function fromWorkbookData(doc: Y.Doc, data: IWorkbookData, formulas: FormulaCodec, origin?: unknown): void {
  doc.transact(() => {
    markSpreadsheet(doc);

    for (const sheetId of data.sheetOrder) {
      const sheetData = data.sheets[sheetId];
      if (sheetData === undefined) {
        continue;
      }
      createSheet(doc, {
        id: sheetId,
        name: sheetData.name ?? sheetId,
        rows: sheetData.rowCount ?? 0,
        columns: sheetData.columnCount ?? 0,
      });
    }

    const workbook = new WorkbookIndex(doc);
    for (const { id, sheet } of readSheets(doc)) {
      const sheetData = data.sheets[id];
      if (sheetData !== undefined) {
        fillSheet(doc, id, sheet, sheetData, data.styles, workbook, formulas);
      }
    }
  }, origin);
}

function fillSheet(
  doc: Y.Doc,
  sheetId: string,
  sheet: SheetMap,
  data: Partial<IWorksheetData>,
  styles: IWorkbookData['styles'],
  workbook: WorkbookIndex,
  formulas: FormulaCodec,
): void {
  const { rows, columns } = workbook.sheetAxes(sheetId) as SheetAxes;
  const resolveStyle = (style: unknown): string | undefined => {
    if (typeof style === 'string') {
      const referenced = styles[style];
      return referenced ? internStyle(doc, referenced as StyleData) : undefined;
    }
    if (typeof style === 'object' && style !== null) {
      return internStyle(doc, style as StyleData);
    }
    return undefined;
  };

  const cellData = structuredClone(data.cellData ?? {}) as Record<string, Record<string, CellData | null>>;
  expandSharedFormulas(cellData);

  for (const [rowKey, rowCells] of Object.entries(cellData)) {
    const row = Number(rowKey);
    const rowId = rows.idAt(row);
    if (rowId === undefined) {
      continue;
    }
    for (const [columnKey, stored] of Object.entries(rowCells ?? {})) {
      const column = Number(columnKey);
      const columnId = columns.idAt(column);
      if (columnId === undefined || stored === undefined || stored === null) {
        continue;
      }
      const cell = stored as CellData;
      const content = encodeContent(cell, (formula) =>
        formulas.store(formula, { sheetId, row, column, workbook }),
      );
      writeContent(sheet, rowId, columnId, content);
      writeCellStyleId(sheet, rowId, columnId, resolveStyle(cell.s));
    }
  }

  fillLines(sheet, 'rows', rows, data.rowData as Record<string, Record<string, unknown>> | undefined, resolveStyle);
  fillLines(sheet, 'columns', columns, data.columnData as Record<string, Record<string, unknown>> | undefined, resolveStyle);

  for (const merge of data.mergeData ?? []) {
    addMerge(sheet, { ...merge, rangeType: RANGE_TYPE_NORMAL });
  }

  writeSheetProperty(sheet, SHEET_HIDDEN, data.hidden ? data.hidden : undefined);
  writeSheetProperty(sheet, SHEET_TAB_COLOR, data.tabColor ? data.tabColor : undefined);
  writeSheetProperty(sheet, SHEET_GRIDLINES, data.showGridlines);
  writeSheetProperty(sheet, SHEET_RIGHT_TO_LEFT, data.rightToLeft ? data.rightToLeft : undefined);
  writeSheetProperty(sheet, SHEET_DEFAULT_ROW_HEIGHT, data.defaultRowHeight);
  writeSheetProperty(sheet, SHEET_DEFAULT_COLUMN_WIDTH, data.defaultColumnWidth);
  writeSheetProperty(sheet, SHEET_FREEZE, isFreeze(data.freeze) ? { ...data.freeze } : undefined);
  writeSheetProperty(sheet, SHEET_GRIDLINES_COLOR, data.gridlinesColor ? data.gridlinesColor : undefined);
  writeSheetProperty(sheet, SHEET_DEFAULT_STYLE, resolveStyleObject(data.defaultStyle, styles));
}

function resolveStyleObject(style: unknown, styles: IWorkbookData['styles']): StyleData | undefined {
  if (typeof style === 'string') {
    const referenced = styles[style];
    return referenced ? ({ ...referenced } as StyleData) : undefined;
  }
  if (typeof style === 'object' && style !== null) {
    return { ...(style as StyleData) };
  }
  return undefined;
}

function fillLines(
  sheet: SheetMap,
  dimension: Dimension,
  axis: Axis,
  lines: Record<string, Record<string, unknown>> | undefined,
  resolveStyle: (style: unknown) => string | undefined,
): void {
  for (const [key, properties] of Object.entries(lines ?? {})) {
    const id = axis.idAt(Number(key));
    const entry = id === undefined ? undefined : line(sheet, dimension, id);
    if (entry === undefined || properties === undefined || properties === null) {
      continue;
    }
    const size = properties[dimension === 'rows' ? 'h' : 'w'];
    if (typeof size === 'number') {
      entry.set(LINE_SIZE, size);
    }
    if (properties.hd === 1) {
      entry.set(LINE_HIDDEN, 1);
    }
    if (dimension === 'rows' && properties.ia === 0) {
      entry.set(LINE_AUTO_SIZE, 0);
    }
    const style = resolveStyle(properties.s);
    if (style !== undefined) {
      entry.set(LINE_STYLE, style);
    }
  }
}
