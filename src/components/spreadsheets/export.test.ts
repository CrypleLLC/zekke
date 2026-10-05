import { afterEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { exportDelimited, exportXlsx, newSpreadsheetDoc, readXlsx } from '@/lib/spreadsheets';
import { calculation, device, disposeDevices, set } from '@/test/spreadsheets';
import type { LocaleType } from '@univerjs/core';

afterEach(disposeDevices);

const IDENTITY = { unitId: 'unit', name: 'Book', locale: 'enUS' as LocaleType, appVersion: '1.0.3' };

describe('downloading from the editor', () => {
  it('writes an xlsx whose formulas carry the values Univer computed, and a CSV of values', async () => {
    const editor = device(newSpreadsheetDoc());
    await set(editor, 0, 0, 1200);
    await set(editor, 1, 0, 450.5);
    await set(editor, 2, 0, '=SUM(A1:A2)');
    await set(editor, 0, 1, '=XLOOKUP(450.5,A1:A2,A1:A2)');
    await calculation();

    const snapshot = editor.binding.workbookSnapshot();
    const bytes = await exportXlsx(snapshot, editor.doc);
    const sheetXml = await (await JSZip.loadAsync(bytes)).file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheetXml).toContain('<f>SUM(A1:A2)</f><v>1650.5</v>');
    expect(sheetXml).toContain('<f>_xlfn.XLOOKUP(450.5,A1:A2,A1:A2)</f>');

    const again = await readXlsx(bytes, IDENTITY);
    const cells = again.workbook.sheets[again.workbook.sheetOrder[0]]!.cellData!;
    expect(cells[2][0]).toMatchObject({ f: '=SUM(A1:A2)' });

    expect(exportDelimited(snapshot, editor.binding.activeSheetId(), ',')).toBe('1200,450.5\r\n450.5,\r\n1650.5,\r\n');
  });
});
