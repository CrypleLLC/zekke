import * as Y from 'yjs';

export const META_MAP = 'meta';
export const TITLE_FIELD = 'title';
export const KIND_FIELD = 'kind';
export const SPREADSHEET_KIND = 'spreadsheet';

export const SHEET_ORDER = 'sheetOrder';
export const SHEETS = 'sheets';
export const STYLES = 'styles';
export const NAMES = 'names';

export const SHEET_NAME = 'name';
export const SHEET_HIDDEN = 'hidden';
export const SHEET_TAB_COLOR = 'tabColor';
export const SHEET_FREEZE = 'freeze';
export const SHEET_GRIDLINES = 'gridlines';
export const SHEET_GRIDLINES_COLOR = 'gridlinesColor';
export const SHEET_DEFAULT_STYLE = 'defaultStyle';
export const SHEET_RIGHT_TO_LEFT = 'rightToLeft';
export const SHEET_DEFAULT_ROW_HEIGHT = 'defaultRowHeight';
export const SHEET_DEFAULT_COLUMN_WIDTH = 'defaultColumnWidth';
export const SHEET_ROW_ORDER = 'rowOrder';
export const SHEET_COLUMN_ORDER = 'columnOrder';
export const SHEET_REMOVED_ROWS = 'removedRows';
export const SHEET_REMOVED_COLUMNS = 'removedColumns';
export const SHEET_ROWS = 'rows';
export const SHEET_COLUMNS = 'columns';
export const SHEET_MERGES = 'merges';
export const SHEET_RULES = 'rules';

export const STYLE_KEY_PREFIX = '~';
export const LINE_PROPERTY_PREFIX = '^';
export const LINE_SIZE = '^size';
export const LINE_HIDDEN = '^hidden';
export const LINE_AUTO_SIZE = '^auto';
export const LINE_STYLE = '~';

export type Dimension = 'rows' | 'columns';

export type SheetMap = Y.Map<unknown>;
export type LineMap = Y.Map<unknown>;

export function readKind(doc: Y.Doc): string | undefined {
  const stored = doc.getMap(META_MAP).get(KIND_FIELD);
  return typeof stored === 'string' ? stored : undefined;
}

export function isSpreadsheet(doc: Y.Doc): boolean {
  return readKind(doc) === SPREADSHEET_KIND;
}

export function markSpreadsheet(doc: Y.Doc, origin?: unknown): void {
  doc.transact(() => {
    doc.getMap(META_MAP).set(KIND_FIELD, SPREADSHEET_KIND);
  }, origin);
}

export function sheetOrderArray(doc: Y.Doc): Y.Array<string> {
  return doc.getArray<string>(SHEET_ORDER);
}

export function sheetsMap(doc: Y.Doc): Y.Map<SheetMap> {
  return doc.getMap<SheetMap>(SHEETS);
}

export function stylesMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(STYLES);
}

export function namesMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(NAMES);
}

export function orderArray(sheet: SheetMap, dimension: Dimension): Y.Array<string> {
  return sheet.get(dimension === 'rows' ? SHEET_ROW_ORDER : SHEET_COLUMN_ORDER) as Y.Array<string>;
}

export function removedMap(sheet: SheetMap, dimension: Dimension): Y.Map<true> {
  return sheet.get(dimension === 'rows' ? SHEET_REMOVED_ROWS : SHEET_REMOVED_COLUMNS) as Y.Map<true>;
}

export function linesMap(sheet: SheetMap, dimension: Dimension): Y.Map<LineMap> {
  return sheet.get(dimension === 'rows' ? SHEET_ROWS : SHEET_COLUMNS) as Y.Map<LineMap>;
}

export function mergesMap(sheet: SheetMap): Y.Map<unknown> {
  return sheet.get(SHEET_MERGES) as Y.Map<unknown>;
}

export function rulesMap(sheet: SheetMap): Y.Map<unknown> {
  return sheet.get(SHEET_RULES) as Y.Map<unknown>;
}

export function newSheetMap(name: string): SheetMap {
  const sheet = new Y.Map<unknown>();
  sheet.set(SHEET_NAME, name);
  sheet.set(SHEET_ROW_ORDER, new Y.Array<string>());
  sheet.set(SHEET_COLUMN_ORDER, new Y.Array<string>());
  sheet.set(SHEET_REMOVED_ROWS, new Y.Map<true>());
  sheet.set(SHEET_REMOVED_COLUMNS, new Y.Map<true>());
  sheet.set(SHEET_ROWS, new Y.Map<LineMap>());
  sheet.set(SHEET_COLUMNS, new Y.Map<LineMap>());
  sheet.set(SHEET_MERGES, new Y.Map<unknown>());
  sheet.set(SHEET_RULES, new Y.Map<unknown>());
  return sheet;
}

export function styleKey(columnId: string): string {
  return STYLE_KEY_PREFIX + columnId;
}

export function isCellKey(key: string): boolean {
  return !key.startsWith(STYLE_KEY_PREFIX) && !key.startsWith(LINE_PROPERTY_PREFIX);
}
