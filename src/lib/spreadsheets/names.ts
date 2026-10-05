import * as Y from 'yjs';
import { namesMap } from './layout';

export interface StoredName {
  name: string;
  formula: string;
  sheetId?: string;
  comment?: string;
  hidden?: boolean;
}

export function isStoredName(value: unknown): value is StoredName {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === 'string' &&
    typeof record.formula === 'string' &&
    (record.sheetId === undefined || typeof record.sheetId === 'string') &&
    (record.comment === undefined || typeof record.comment === 'string') &&
    (record.hidden === undefined || typeof record.hidden === 'boolean')
  );
}

export function readNames(doc: Y.Doc): Map<string, StoredName> {
  const names = new Map<string, StoredName>();
  namesMap(doc).forEach((value, id) => {
    if (isStoredName(value)) {
      names.set(id, value);
    }
  });
  return names;
}

export function writeName(doc: Y.Doc, id: string, name: StoredName | undefined, origin?: unknown): void {
  doc.transact(() => {
    const names = namesMap(doc);
    if (name === undefined) {
      if (names.has(id)) {
        names.delete(id);
      }
      return;
    }
    const clean: StoredName = { name: name.name, formula: name.formula };
    if (name.sheetId !== undefined) {
      clean.sheetId = name.sheetId;
    }
    if (name.comment !== undefined && name.comment !== '') {
      clean.comment = name.comment;
    }
    if (name.hidden === true) {
      clean.hidden = true;
    }
    if (JSON.stringify(names.get(id)) !== JSON.stringify(clean)) {
      names.set(id, clean);
    }
  }, origin);
}
