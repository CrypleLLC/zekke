import { describe, expect, it } from 'vitest';
import { ImportTooLargeError, UnsupportedFormatError } from '@/lib/spreadsheets';
import { importErrorMessage, importedMessage, lostFeaturesLabel } from './spreadsheet-files';

describe('the import messages', () => {
  it('say what was imported, and name what was left behind with counts', () => {
    expect(importedMessage('Budget', 1, {})).toBe('Imported “Budget”. It opens in its own tab.');
    expect(importedMessage('Budget', 3, { comments: 1, conditionalFormats: 2, hyperlinks: 1 })).toBe(
      'Imported “Budget” with 3 sheets. It opens in its own tab. Not carried over: 1 comment, 2 conditional formats, 1 link (the text is kept).',
    );
    expect(lostFeaturesLabel({ images: 0 })).toBeUndefined();
  });

  it('explain a refused file without naming its content', () => {
    expect(importErrorMessage(new UnsupportedFormatError('a.ods'))).toContain('.xlsx, .csv and .tsv');
    expect(
      importErrorMessage(new ImportTooLargeError({ reason: 'workbook-full', usedBytes: 0, addedBytes: 1, limitBytes: 1 })),
    ).toContain('Nothing was created');
    expect(
      importErrorMessage(new ImportTooLargeError({ reason: 'cell-too-large', usedBytes: 0, addedBytes: 1, limitBytes: 1 })),
    ).toContain('cell too large');
    expect(importErrorMessage(new Error('zip'))).toBeUndefined();
  });
});
