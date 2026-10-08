import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { countryDefaults, spreadsheetCountryDefaults, spreadsheetDefaults } from '@/lib/regional';
import { importSpreadsheet } from './interchange';
import { newSpreadsheetDoc } from './preview';
import { rebuildSpreadsheet } from './rebuild';
import { hasSheetRegional, observeSheetRegional, readSheetRegional, writeSheetRegional } from './sheet-regional';

const account = countryDefaults('BR');

describe('a spreadsheet’s own regional settings', () => {
  it('follow the account until the spreadsheet has its own', () => {
    const doc = newSpreadsheetDoc();
    expect(hasSheetRegional(doc)).toBe(false);
    expect(readSheetRegional(doc, account)).toEqual(spreadsheetDefaults(account));
    expect(readSheetRegional(doc, countryDefaults('DE')).functions).toBe('de');
  });

  it('are stamped on a new spreadsheet and kept whatever the account later says', () => {
    const doc = newSpreadsheetDoc(spreadsheetDefaults(account));
    expect(readSheetRegional(doc, countryDefaults('US'))).toEqual(spreadsheetDefaults(account));
  });

  it('travel with the document to another replica, and tell whoever listens', () => {
    const doc = newSpreadsheetDoc();
    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
    let heard = 0;
    const stop = observeSheetRegional(replica, () => heard++);
    const french = { ...spreadsheetCountryDefaults('FR', 'fr'), currency: 'CHF' };
    writeSheetRegional(doc, french);
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc));
    stop();
    expect(heard).toBe(1);
    expect(readSheetRegional(replica, account)).toEqual(french);
  });

  it('survive a rebuild without history', () => {
    const doc = newSpreadsheetDoc(spreadsheetCountryDefaults('DE', 'de'));
    expect(readSheetRegional(rebuildSpreadsheet(doc), account)).toEqual(spreadsheetCountryDefaults('DE', 'de'));
  });

  it('are stamped on an imported file', async () => {
    const regional = spreadsheetCountryDefaults('PT', 'pt-PT');
    const imported = await importSpreadsheet('book.csv', new TextEncoder().encode('a,b\n1,2\n'), regional);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, imported.snapshot);
    expect(readSheetRegional(doc, account)).toEqual(regional);
  });
});
