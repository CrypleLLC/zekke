import * as Y from 'yjs';
import {
  parseSpreadsheetRegional,
  spreadsheetDefaults,
  type RegionalPreferences,
  type SpreadsheetRegional,
} from '@/lib/regional';
import { META_MAP } from './layout';

export const REGIONAL_FIELD = 'regional';

export function hasSheetRegional(doc: Y.Doc): boolean {
  const stored = doc.getMap(META_MAP).get(REGIONAL_FIELD);
  return typeof stored === 'object' && stored !== null;
}

export function readSheetRegional(doc: Y.Doc, account: RegionalPreferences): SpreadsheetRegional {
  const fallback = spreadsheetDefaults(account);
  return hasSheetRegional(doc) ? parseSpreadsheetRegional(doc.getMap(META_MAP).get(REGIONAL_FIELD), fallback) : fallback;
}

export function writeSheetRegional(doc: Y.Doc, regional: SpreadsheetRegional, origin?: unknown): void {
  doc.transact(() => {
    doc.getMap(META_MAP).set(REGIONAL_FIELD, { ...regional });
  }, origin);
}

export function observeSheetRegional(doc: Y.Doc, listener: () => void): () => void {
  const meta = doc.getMap(META_MAP);
  const observer = (event: Y.YMapEvent<unknown>) => {
    if (event.keysChanged.has(REGIONAL_FIELD)) {
      listener();
    }
  };
  meta.observe(observer);
  return () => meta.unobserve(observer);
}
