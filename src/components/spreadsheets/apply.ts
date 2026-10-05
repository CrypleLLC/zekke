import { mergeWorksheetSnapshotWithDefault, type ICellData, type IStyleData, type IWorksheetData } from '@univerjs/core';
import * as Y from 'yjs';
import {
  LINE_AUTO_SIZE,
  LINE_HIDDEN,
  LINE_PROPERTY_PREFIX,
  LINE_SIZE,
  LINE_STYLE,
  META_MAP,
  SHEET_DEFAULT_STYLE,
  SHEET_FREEZE,
  SHEET_GRIDLINES,
  SHEET_GRIDLINES_COLOR,
  SHEET_HIDDEN,
  SHEET_NAME,
  SHEET_RIGHT_TO_LEFT,
  SHEET_TAB_COLOR,
  TITLE_FIELD,
  WorkbookIndex,
  decodeContent,
  isCellContent,
  isCellKey,
  line,
  linesMap,
  readAxis,
  readCellStyleId,
  readContent,
  readMerges,
  readNames,
  readSheet,
  readSheetName,
  readSheets,
  readStyle,
  styleKey,
  toSheetData,
  type Dimension,
  type FormulaCodec,
  type SheetMap,
} from '@/lib/spreadsheets';
import type { Changes, SheetChanges } from './changes';
import { WorkbookMirror, planAxis, planOrder, type SheetMirror } from './mirror';
import type { UniverSurface } from './surface';

export interface ApplyContext {
  doc: Y.Doc;
  surface: UniverSurface;
  mirror: WorkbookMirror;
  codec: FormulaCodec;
}

type CellMatrix = Record<number, Record<number, ICellData>>;

const EMPTY_CELL: ICellData = { v: null, t: null, f: null, si: null, p: null, s: null };

export function applyChanges(context: ApplyContext, changes: Changes): void {
  let structural = false;
  const fresh = new Set<string>();

  if (changes.sheets) {
    const result = reconcileSheets(context);
    structural ||= result.changed;
    for (const id of result.inserted) {
      fresh.add(id);
    }
  }

  for (const [sheetId, sheetChanges] of changes.bySheet) {
    if (fresh.has(sheetId) || !context.mirror.sheets.has(sheetId)) {
      continue;
    }
    const sheet = readSheet(context.doc, sheetId);
    if (sheet === undefined) {
      continue;
    }
    structural = applySheetChanges(context, sheetId, sheet, sheetChanges) || structural;
  }

  if (structural) {
    refreshFormulas(context);
  }
  if (changes.names || structural) {
    reconcileNames(context);
  }
  if (changes.title) {
    const title = context.doc.getMap(META_MAP).get(TITLE_FIELD);
    context.surface.apply('sheet.mutation.set-workbook-name', {
      unitId: context.surface.unitId,
      name: typeof title === 'string' ? title : '',
    });
  }
}

function reconcileSheets(context: ApplyContext): { changed: boolean; inserted: string[] } {
  const { doc, surface, mirror } = context;
  const target = readSheets(doc).map(({ id }) => id);
  const targetSet = new Set(target);
  let changed = false;
  const inserted: string[] = [];

  for (const id of [...mirror.order]) {
    if (targetSet.has(id)) {
      continue;
    }
    surface.apply('sheet.mutation.remove-sheet', {
      unitId: surface.unitId,
      subUnitId: id,
      subUnitName: mirror.sheet(id)?.name ?? '',
    });
    mirror.order.splice(mirror.order.indexOf(id), 1);
    mirror.sheets.delete(id);
    changed = true;
  }

  target.forEach((id, index) => {
    if (mirror.sheets.has(id)) {
      return;
    }
    const converted = toSheetData(doc, id, context.codec);
    const sheet = readSheet(doc, id);
    if (converted === undefined || sheet === undefined) {
      return;
    }
    const position = Math.min(index, mirror.order.length);
    surface.apply('sheet.mutation.insert-sheet', {
      unitId: surface.unitId,
      index: position,
      sheet: mergeWorksheetSnapshotWithDefault(converted.sheet),
      styles: converted.styles,
    });
    mirror.order.splice(position, 0, id);
    mirror.sheets.set(id, {
      name: readSheetName(sheet),
      rows: [...readAxis(sheet, 'rows').ids],
      columns: [...readAxis(sheet, 'columns').ids],
    });
    inserted.push(id);
    changed = true;
  });

  for (const step of planOrder(mirror.order, target)) {
    surface.apply('sheet.mutation.set-worksheet-order', {
      unitId: surface.unitId,
      subUnitId: step.id,
      fromOrder: step.from,
      toOrder: step.to,
    });
    mirror.order.splice(step.from, 1);
    mirror.order.splice(step.to, 0, step.id);
    changed = true;
  }

  return { changed, inserted };
}

function applySheetChanges(context: ApplyContext, sheetId: string, sheet: SheetMap, changes: SheetChanges): boolean {
  const mirror = context.mirror.sheet(sheetId) as SheetMirror;
  let structural = false;

  for (const key of changes.properties) {
    structural = applySheetProperty(context, sheetId, sheet, key) || structural;
  }

  const insertedRows = changes.rowOrder ? reconcileAxis(context, sheetId, sheet, mirror, 'rows') : [];
  const insertedColumns = changes.columnOrder ? reconcileAxis(context, sheetId, sheet, mirror, 'columns') : [];
  const axesChanged = changes.rowOrder || changes.columnOrder;
  structural ||= axesChanged;

  const cells = new Map<string, Set<string> | 'all'>();
  for (const rowId of [...insertedRows, ...changes.replacedRows]) {
    cells.set(rowId, 'all');
  }
  for (const [rowId, columns] of changes.cells) {
    const existing = cells.get(rowId);
    if (existing === 'all') {
      continue;
    }
    cells.set(rowId, new Set([...(existing ?? []), ...columns]));
  }
  if (insertedColumns.length > 0 || changes.replacedColumns.size > 0) {
    const columns = new Set([...insertedColumns, ...changes.replacedColumns]);
    linesMap(sheet, 'rows').forEach((row, rowId) => {
      const existing = cells.get(rowId);
      if (existing === 'all') {
        return;
      }
      const touched = [...columns].filter((columnId) => row.has(columnId) || row.has(styleKey(columnId)));
      if (touched.length > 0) {
        cells.set(rowId, new Set([...(existing ?? []), ...touched]));
      }
    });
  }
  writeCells(context, sheetId, sheet, mirror, cells);

  writeLines(context, sheetId, sheet, mirror, 'rows', new Set([...insertedRows, ...changes.replacedRows, ...changes.rowProperties]));
  writeLines(
    context,
    sheetId,
    sheet,
    mirror,
    'columns',
    new Set([...insertedColumns, ...changes.replacedColumns, ...changes.columnProperties]),
  );

  if (changes.merges || axesChanged) {
    reconcileMerges(context, sheetId, sheet);
  }

  return structural;
}

function reconcileAxis(
  context: ApplyContext,
  sheetId: string,
  sheet: SheetMap,
  mirror: SheetMirror,
  dimension: Dimension,
): string[] {
  const { surface } = context;
  const target = readAxis(sheet, dimension).ids;
  const current = mirror[dimension];
  const inserted: string[] = [];
  const isRows = dimension === 'rows';

  for (const step of planAxis(current, target)) {
    const range = isRows
      ? { startRow: step.index, endRow: step.index, startColumn: 0, endColumn: Math.max(0, mirror.columns.length - 1) }
      : { startRow: 0, endRow: Math.max(0, mirror.rows.length - 1), startColumn: step.index, endColumn: step.index };
    if (step.action === 'remove') {
      surface.apply(isRows ? 'sheet.mutation.remove-rows' : 'sheet.mutation.remove-col', {
        unitId: surface.unitId,
        subUnitId: sheetId,
        range,
      });
      current.splice(step.index, 1);
    } else {
      surface.apply(isRows ? 'sheet.mutation.insert-row' : 'sheet.mutation.insert-col', {
        unitId: surface.unitId,
        subUnitId: sheetId,
        range,
      });
      current.splice(step.index, 0, step.id);
      inserted.push(step.id);
    }
  }
  return inserted;
}

function cellValue(
  context: ApplyContext,
  sheetId: string,
  sheet: SheetMap,
  rowId: string,
  columnId: string,
  row: number,
  column: number,
  workbook: WorkbookIndex,
): ICellData {
  const content = readContent(sheet, rowId, columnId);
  const styleId = readCellStyleId(sheet, rowId, columnId);
  const cell: ICellData = { ...EMPTY_CELL };
  if (content !== undefined) {
    Object.assign(
      cell,
      decodeContent(content, (stored) => context.codec.display(stored, { sheetId, row, column, workbook })),
    );
  }
  const style = styleId === undefined ? undefined : readStyle(context.doc, styleId);
  cell.s = style === undefined ? null : (style as IStyleData);
  return cell;
}

function writeCells(
  context: ApplyContext,
  sheetId: string,
  sheet: SheetMap,
  mirror: SheetMirror,
  cells: Map<string, Set<string> | 'all'>,
): void {
  if (cells.size === 0) {
    return;
  }
  const workbook = new WorkbookIndex(context.doc);
  const rowIndex = new Map(mirror.rows.map((id, index) => [id, index]));
  const columnIndex = new Map(mirror.columns.map((id, index) => [id, index]));
  const matrix: CellMatrix = {};
  let count = 0;

  for (const [rowId, columns] of cells) {
    const row = rowIndex.get(rowId);
    if (row === undefined) {
      continue;
    }
    const columnIds =
      columns === 'all'
        ? [...(line(sheet, 'rows', rowId)?.keys() ?? [])]
            .filter((key) => key !== LINE_STYLE && !key.startsWith(LINE_PROPERTY_PREFIX))
            .map((key) => (isCellKey(key) ? key : key.slice(1)))
        : [...columns];
    for (const columnId of new Set(columnIds)) {
      const column = columnIndex.get(columnId);
      if (column === undefined) {
        continue;
      }
      (matrix[row] ??= {})[column] = cellValue(context, sheetId, sheet, rowId, columnId, row, column, workbook);
      count += 1;
    }
  }

  if (count > 0) {
    context.surface.apply('sheet.mutation.set-range-values', {
      unitId: context.surface.unitId,
      subUnitId: sheetId,
      cellValue: matrix,
    });
  }
}

function writeLines(
  context: ApplyContext,
  sheetId: string,
  sheet: SheetMap,
  mirror: SheetMirror,
  dimension: Dimension,
  ids: ReadonlySet<string>,
): void {
  if (ids.size === 0) {
    return;
  }
  const { surface } = context;
  const position = new Map(mirror[dimension].map((id, index) => [id, index]));
  const sizes: Record<number, number | null> = {};
  const styles: Record<number, { s: IStyleData | null }> = {};
  const autoSize: Record<number, 0 | 1> = {};
  const hidden: { startRow: number; endRow: number; startColumn: number; endColumn: number }[] = [];
  const visible: typeof hidden = [];
  const ranges: typeof hidden = [];

  for (const id of ids) {
    const index = position.get(id);
    const entry = line(sheet, dimension, id);
    if (index === undefined || entry === undefined) {
      continue;
    }
    const size = entry.get(LINE_SIZE);
    sizes[index] = typeof size === 'number' ? size : null;
    const styleId = entry.get(LINE_STYLE);
    const style = typeof styleId === 'string' ? readStyle(context.doc, styleId) : undefined;
    styles[index] = { s: style === undefined ? null : (style as IStyleData) };
    autoSize[index] = entry.get(LINE_AUTO_SIZE) === 0 ? 0 : 1;
    const range =
      dimension === 'rows'
        ? { startRow: index, endRow: index, startColumn: 0, endColumn: Math.max(0, mirror.columns.length - 1) }
        : { startRow: 0, endRow: Math.max(0, mirror.rows.length - 1), startColumn: index, endColumn: index };
    ranges.push(range);
    (entry.get(LINE_HIDDEN) === 1 ? hidden : visible).push(range);
  }
  if (ranges.length === 0) {
    return;
  }

  const base = { unitId: surface.unitId, subUnitId: sheetId };
  if (dimension === 'rows') {
    surface.apply('sheet.mutation.set-worksheet-row-height', { ...base, ranges, rowHeight: sizes });
    surface.apply('sheet.mutation.set-worksheet-row-is-auto-height', { ...base, ranges, autoHeightInfo: autoSize });
    surface.apply('sheet.mutation.set-row-data', { ...base, rowData: styles });
    if (hidden.length > 0) {
      surface.apply('sheet.mutation.set-row-hidden', { ...base, ranges: hidden });
    }
    if (visible.length > 0) {
      surface.apply('sheet.mutation.set-row-visible', { ...base, ranges: visible });
    }
  } else {
    surface.apply('sheet.mutation.set-worksheet-col-width', { ...base, ranges, colWidth: sizes });
    surface.apply('sheet.mutation.set-col-data', { ...base, columnData: styles });
    if (hidden.length > 0) {
      surface.apply('sheet.mutation.set-col-hidden', { ...base, ranges: hidden });
    }
    if (visible.length > 0) {
      surface.apply('sheet.mutation.set-col-visible', { ...base, ranges: visible });
    }
  }
}

function mergeKey(range: { startRow: number; endRow: number; startColumn: number; endColumn: number }): string {
  return `${range.startRow}:${range.endRow}:${range.startColumn}:${range.endColumn}`;
}

function reconcileMerges(context: ApplyContext, sheetId: string, sheet: SheetMap): void {
  const { surface } = context;
  const worksheet = surface.worksheet(sheetId);
  if (worksheet === undefined) {
    return;
  }
  const current = worksheet.getMergeData().map((range) => ({ ...range }));
  const wanted = readMerges(sheet).map(({ range }) => ({
    startRow: range.startRow,
    endRow: range.endRow,
    startColumn: range.startColumn,
    endColumn: range.endColumn,
    rangeType: 0,
  }));
  const wantedKeys = new Set(wanted.map(mergeKey));
  const currentKeys = new Set(current.map(mergeKey));
  const remove = current.filter((range) => !wantedKeys.has(mergeKey(range)));
  const add = wanted.filter((range) => !currentKeys.has(mergeKey(range)));
  const base = { unitId: surface.unitId, subUnitId: sheetId };
  if (remove.length > 0) {
    surface.apply('sheet.mutation.remove-worksheet-merge', { ...base, ranges: remove });
  }
  if (add.length > 0) {
    surface.apply('sheet.mutation.add-worksheet-merge', { ...base, ranges: add });
  }
}

function applySheetProperty(context: ApplyContext, sheetId: string, sheet: SheetMap, key: string): boolean {
  const { surface } = context;
  const base = { unitId: surface.unitId, subUnitId: sheetId };
  const value = sheet.get(key);
  switch (key) {
    case SHEET_NAME: {
      const name = typeof value === 'string' ? value : '';
      surface.apply('sheet.mutation.set-worksheet-name', { ...base, name });
      const mirror = context.mirror.sheet(sheetId);
      if (mirror !== undefined) {
        mirror.name = name;
      }
      return true;
    }
    case SHEET_HIDDEN:
      surface.apply('sheet.mutation.set-worksheet-hidden', { ...base, hidden: typeof value === 'number' ? value : 0 });
      return false;
    case SHEET_TAB_COLOR:
      surface.apply('sheet.mutation.set-tab-color', { ...base, color: typeof value === 'string' ? value : '' });
      return false;
    case SHEET_FREEZE: {
      const freeze = (value ?? { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 }) as IWorksheetData['freeze'];
      surface.apply('sheet.mutation.set-frozen', { ...base, ...freeze });
      return false;
    }
    case SHEET_GRIDLINES:
      surface.apply('sheet.mutation.toggle-gridlines', { ...base, showGridlines: value === 0 ? 0 : 1 });
      return false;
    case SHEET_GRIDLINES_COLOR:
      surface.apply('sheet.mutation.set-gridlines-color', { ...base, color: typeof value === 'string' ? value : undefined });
      return false;
    case SHEET_RIGHT_TO_LEFT:
      surface.apply('sheet.mutation.set-worksheet-right-to-left', { ...base, rightToLeft: value === 1 ? 1 : 0 });
      return false;
    case SHEET_DEFAULT_STYLE:
      surface.apply('sheet.mutation.set-worksheet-default-style', {
        ...base,
        defaultStyle: typeof value === 'object' && value !== null ? value : null,
      });
      return false;
  }
  return false;
}

export function refreshFormulas(context: ApplyContext): void {
  const { doc, surface } = context;
  const workbook = new WorkbookIndex(doc);
  for (const { id: sheetId, sheet } of readSheets(doc)) {
    const mirror = context.mirror.sheet(sheetId);
    if (mirror === undefined) {
      continue;
    }
    const columnIndex = new Map(mirror.columns.map((id, index) => [id, index]));
    const matrix: CellMatrix = {};
    let count = 0;
    mirror.rows.forEach((rowId, row) => {
      const entry = line(sheet, 'rows', rowId);
      entry?.forEach((content, columnId) => {
        if (!isCellKey(columnId) || !isCellContent(content) || typeof content !== 'object' || !('f' in content)) {
          return;
        }
        const column = columnIndex.get(columnId);
        if (column === undefined) {
          return;
        }
        const shown = context.codec.display(content.f, { sheetId, row, column, workbook });
        if (surface.rawCell(sheetId, row, column).f === shown) {
          return;
        }
        (matrix[row] ??= {})[column] = cellValue(context, sheetId, sheet, rowId, columnId, row, column, workbook);
        count += 1;
      });
    });
    if (count > 0) {
      surface.apply('sheet.mutation.set-range-values', { unitId: surface.unitId, subUnitId: sheetId, cellValue: matrix });
    }
  }
}

export function reconcileNames(context: ApplyContext): void {
  const { doc, surface, mirror } = context;
  const workbook = new WorkbookIndex(doc);
  const stored = readNames(doc);
  for (const id of surface.definedNameIds()) {
    if (!stored.has(id)) {
      surface.apply('formula.mutation.remove-defined-name', { unitId: surface.unitId, id });
    }
  }
  for (const [id, name] of stored) {
    const scopeSheet = name.sheetId !== undefined && mirror.sheets.has(name.sheetId) ? name.sheetId : mirror.order[0];
    const formula =
      scopeSheet === undefined
        ? name.formula
        : context.codec.display(name.formula, { sheetId: scopeSheet, row: 0, column: 0, workbook });
    const current = surface.definedName(id);
    if (
      current !== undefined &&
      current.name === name.name &&
      current.formulaOrRefString === formula &&
      (current.localSheetId || undefined) === name.sheetId &&
      (current.comment || undefined) === name.comment &&
      (current.hidden === true) === (name.hidden === true)
    ) {
      continue;
    }
    surface.apply('formula.mutation.set-defined-name', {
      unitId: surface.unitId,
      id,
      name: name.name,
      formulaOrRefString: formula,
      localSheetId: name.sheetId,
      comment: name.comment,
      hidden: name.hidden,
    });
  }
}
