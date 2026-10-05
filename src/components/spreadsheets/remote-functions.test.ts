import { afterEach, describe, expect, it } from 'vitest';
import { IFunctionService } from '@univerjs/engine-formula';
import { newSpreadsheetDoc } from '@/lib/spreadsheets';
import { calculation, cellValue, device, disposeDevices, set } from '@/test/spreadsheets';
import { REMOTE_FUNCTIONS, withoutRemoteFunctions } from './remote-functions';

afterEach(disposeDevices);

describe('formulas that would fetch a URL', () => {
  it('are taken out of the engine, so a cell can never make the browser request anything', async () => {
    const editor = device(newSpreadsheetDoc());
    const functions = editor.univer.__getInjector().get(IFunctionService);
    expect(functions.hasExecutor('IMAGE')).toBe(true);

    withoutRemoteFunctions(editor.univer);
    for (const name of REMOTE_FUNCTIONS) {
      expect(functions.hasExecutor(name)).toBe(false);
      expect(functions.getDescriptions().has(name)).toBe(false);
    }

    await set(editor, 0, 0, '=IMAGE("https://tracker.example/pixel.png")');
    await set(editor, 0, 1, '=SUM(1,2)');
    await calculation();
    expect(cellValue(editor, 0, 0)).toBe('#NAME?');
    expect(cellValue(editor, 0, 1)).toBe(3);
  });
});
