import * as Y from 'yjs';
import {
  LINE_PROPERTY_PREFIX,
  LINE_STYLE,
  META_MAP,
  NAMES,
  SHEETS,
  SHEET_COLUMNS,
  SHEET_COLUMN_ORDER,
  SHEET_MERGES,
  SHEET_ORDER,
  SHEET_REMOVED_COLUMNS,
  SHEET_REMOVED_ROWS,
  SHEET_ROWS,
  SHEET_ROW_ORDER,
  SHEET_RULES,
  STYLE_KEY_PREFIX,
  TITLE_FIELD,
} from '@/lib/spreadsheets';

export interface SheetChanges {
  properties: Set<string>;
  rowOrder: boolean;
  columnOrder: boolean;
  replacedRows: Set<string>;
  replacedColumns: Set<string>;
  rowProperties: Set<string>;
  columnProperties: Set<string>;
  cells: Map<string, Set<string>>;
  merges: boolean;
  rules: boolean;
}

export interface Changes {
  sheets: boolean;
  names: boolean;
  title: boolean;
  bySheet: Map<string, SheetChanges>;
}

export function emptyChanges(): Changes {
  return { sheets: false, names: false, title: false, bySheet: new Map() };
}

export function hasChanges(changes: Changes): boolean {
  return changes.sheets || changes.names || changes.title || changes.bySheet.size > 0;
}

function sheetChanges(changes: Changes, sheetId: string): SheetChanges {
  let entry = changes.bySheet.get(sheetId);
  if (entry === undefined) {
    entry = {
      properties: new Set(),
      rowOrder: false,
      columnOrder: false,
      replacedRows: new Set(),
      replacedColumns: new Set(),
      rowProperties: new Set(),
      columnProperties: new Set(),
      cells: new Map(),
      merges: false,
      rules: false,
    };
    changes.bySheet.set(sheetId, entry);
  }
  return entry;
}

type SharedType = Y.Transaction['changed'] extends Map<infer Type, unknown> ? Type : never;

interface Location {
  root: string;
  path: string[];
}

function locate(doc: Y.Doc, type: SharedType): Location | undefined {
  const path: string[] = [];
  let current: SharedType = type;
  while (current._item !== null) {
    const key = current._item.parentSub;
    const parent = current._item.parent;
    if (key === null || !(parent instanceof Y.AbstractType)) {
      return undefined;
    }
    path.unshift(key);
    current = parent as SharedType;
  }
  for (const [root, shared] of doc.share) {
    if (shared === current) {
      return { root, path };
    }
  }
  return undefined;
}

export function collectChanges(doc: Y.Doc, transaction: Y.Transaction, changes: Changes): void {
  transaction.changed.forEach((keys, type) => {
    const location = locate(doc, type);
    if (location === undefined) {
      return;
    }
    const { root, path } = location;

    if (root === SHEET_ORDER) {
      changes.sheets = true;
      return;
    }
    if (root === NAMES) {
      changes.names = true;
      return;
    }
    if (root === META_MAP) {
      if (keys.has(TITLE_FIELD)) {
        changes.title = true;
      }
      return;
    }
    if (root !== SHEETS) {
      return;
    }
    if (path.length === 0) {
      changes.sheets = true;
      return;
    }

    const sheet = sheetChanges(changes, path[0]);
    const part = path[1];
    if (part === undefined) {
      for (const key of keys) {
        if (key !== null) {
          sheet.properties.add(key);
        }
      }
      return;
    }

    switch (part) {
      case SHEET_ROW_ORDER:
      case SHEET_REMOVED_ROWS:
        sheet.rowOrder = true;
        return;
      case SHEET_COLUMN_ORDER:
      case SHEET_REMOVED_COLUMNS:
        sheet.columnOrder = true;
        return;
      case SHEET_MERGES:
        sheet.merges = true;
        return;
      case SHEET_RULES:
        sheet.rules = true;
        return;
      case SHEET_ROWS:
        if (path.length === 2) {
          for (const key of keys) {
            if (key !== null) {
              sheet.replacedRows.add(key);
            }
          }
          return;
        }
        recordRowKeys(sheet, path[2], keys);
        return;
      case SHEET_COLUMNS:
        if (path.length === 2) {
          for (const key of keys) {
            if (key !== null) {
              sheet.replacedColumns.add(key);
            }
          }
          return;
        }
        sheet.columnProperties.add(path[2]);
        return;
    }
  });
}

function recordRowKeys(sheet: SheetChanges, rowId: string, keys: Set<string | null>): void {
  for (const key of keys) {
    if (key === null) {
      continue;
    }
    if (key === LINE_STYLE || key.startsWith(LINE_PROPERTY_PREFIX)) {
      sheet.rowProperties.add(rowId);
      continue;
    }
    const columnId = key.startsWith(STYLE_KEY_PREFIX) ? key.slice(STYLE_KEY_PREFIX.length) : key;
    let cells = sheet.cells.get(rowId);
    if (cells === undefined) {
      cells = new Set();
      sheet.cells.set(rowId, cells);
    }
    cells.add(columnId);
  }
}
