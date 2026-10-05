import * as Y from 'yjs';
import { insertLineIds, line, moveLineIds, removeLineIds } from './axis';
import { writeCellStyleId, writeContent, type CellContent } from './cells';
import { ELEMENT_ID_LENGTH, freshIds } from './ids';
import {
  LINE_AUTO_SIZE,
  LINE_HIDDEN,
  LINE_SIZE,
  LINE_STYLE,
  META_MAP,
  TITLE_FIELD,
  mergesMap,
  rulesMap,
  type Dimension,
  type LineMap,
} from './layout';
import { writeName, type StoredName } from './names';
import { isIdRange, type IdRange } from './ranges';
import type { SheetRule } from './rules';
import { createSheet, moveSheet, readSheet, removeSheet, writeSheetProperty } from './sheets';
import { internStyle, type StyleData } from './styles';

export interface LineProperties {
  size?: number;
  hidden?: boolean;
  manualSize?: boolean;
  style?: StyleData;
}

export type Operation =
  | { kind: 'insert-lines'; sheetId: string; dimension: Dimension; ids: string[]; beforeId?: string }
  | { kind: 'remove-lines'; sheetId: string; dimension: Dimension; ids: string[] }
  | { kind: 'move-lines'; sheetId: string; dimension: Dimension; ids: string[]; beforeId?: string }
  | { kind: 'cell'; sheetId: string; rowId: string; columnId: string; content?: CellContent; style?: StyleData }
  | { kind: 'line'; sheetId: string; dimension: Dimension; id: string; properties: LineProperties }
  | { kind: 'sheet-property'; sheetId: string; key: string; value?: unknown }
  | { kind: 'insert-sheet'; sheetId: string; name: string; index: number; rowIds: string[]; columnIds: string[] }
  | { kind: 'remove-sheet'; sheetId: string }
  | { kind: 'move-sheet'; sheetId: string; index: number }
  | { kind: 'merges'; sheetId: string; merges: IdRange[] }
  | { kind: 'name'; id: string; name?: StoredName }
  | { kind: 'title'; title: string }
  | { kind: 'rule'; sheetId: string; id: string; rule?: SheetRule };

export function applyOperations(doc: Y.Doc, operations: readonly Operation[], origin?: unknown): void {
  if (operations.length === 0) {
    return;
  }
  doc.transact(() => {
    for (const operation of operations) {
      applyOperation(doc, operation);
    }
  }, origin);
}

function applyOperation(doc: Y.Doc, operation: Operation): void {
  switch (operation.kind) {
    case 'insert-sheet':
      if (readSheet(doc, operation.sheetId) === undefined) {
        createSheet(doc, {
          id: operation.sheetId,
          name: operation.name,
          index: operation.index,
          rowIds: operation.rowIds,
          columnIds: operation.columnIds,
        });
      }
      return;
    case 'remove-sheet':
      removeSheet(doc, operation.sheetId);
      return;
    case 'move-sheet':
      moveSheet(doc, operation.sheetId, operation.index);
      return;
    case 'name':
      writeName(doc, operation.id, operation.name);
      return;
    case 'title':
      if (doc.getMap(META_MAP).get(TITLE_FIELD) !== operation.title) {
        doc.getMap(META_MAP).set(TITLE_FIELD, operation.title);
      }
      return;
  }

  const sheet = readSheet(doc, operation.sheetId);
  if (sheet === undefined) {
    return;
  }

  switch (operation.kind) {
    case 'insert-lines':
      insertLineIds(sheet, operation.dimension, operation.ids, operation.beforeId);
      return;
    case 'remove-lines':
      removeLineIds(sheet, operation.dimension, operation.ids);
      return;
    case 'move-lines':
      moveLineIds(sheet, operation.dimension, operation.ids, operation.beforeId);
      return;
    case 'cell':
      writeContent(sheet, operation.rowId, operation.columnId, operation.content);
      writeCellStyleId(
        sheet,
        operation.rowId,
        operation.columnId,
        operation.style === undefined ? undefined : internStyle(doc, operation.style),
      );
      return;
    case 'line': {
      const entry = line(sheet, operation.dimension, operation.id);
      if (entry !== undefined) {
        writeLineProperties(doc, entry, operation.properties);
      }
      return;
    }
    case 'sheet-property':
      writeSheetProperty(sheet, operation.key, operation.value);
      return;
    case 'merges':
      replaceMerges(mergesMap(sheet), operation.merges);
      return;
    case 'rule': {
      const rules = rulesMap(sheet);
      if (operation.rule === undefined) {
        if (rules.has(operation.id)) {
          rules.delete(operation.id);
        }
      } else if (JSON.stringify(rules.get(operation.id)) !== JSON.stringify(operation.rule)) {
        rules.set(operation.id, operation.rule);
      }
      return;
    }
  }
}

function writeKey(entry: LineMap, key: string, value: unknown): void {
  if (value === undefined) {
    if (entry.has(key)) {
      entry.delete(key);
    }
    return;
  }
  if (entry.get(key) !== value) {
    entry.set(key, value);
  }
}

function writeLineProperties(doc: Y.Doc, entry: LineMap, properties: LineProperties): void {
  writeKey(entry, LINE_SIZE, properties.size);
  writeKey(entry, LINE_HIDDEN, properties.hidden === true ? 1 : undefined);
  writeKey(entry, LINE_AUTO_SIZE, properties.manualSize === true ? 0 : undefined);
  writeKey(entry, LINE_STYLE, properties.style === undefined ? undefined : internStyle(doc, properties.style));
}

function rangeKey(range: IdRange): string {
  return [range.startRow ?? '', range.endRow ?? '', range.startColumn ?? '', range.endColumn ?? ''].join('|');
}

function replaceMerges(merges: Y.Map<unknown>, wanted: readonly IdRange[]): void {
  const wantedKeys = new Set(wanted.map(rangeKey));
  const present = new Set<string>();
  for (const [id, stored] of [...merges.entries()]) {
    const key = isIdRange(stored) ? rangeKey(stored) : undefined;
    if (key === undefined || !wantedKeys.has(key) || present.has(key)) {
      merges.delete(id);
      continue;
    }
    present.add(key);
  }
  for (const range of wanted) {
    const key = rangeKey(range);
    if (present.has(key)) {
      continue;
    }
    present.add(key);
    merges.set(freshIds(1, ELEMENT_ID_LENGTH, new Set(merges.keys()))[0], { ...range });
  }
}
