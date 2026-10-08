import {
  ILocalStorageService,
  LocaleType,
  LogLevel,
  Univer,
  UniverInstanceType,
  mergeLocales,
} from '@univerjs/core';
import { UniverDataValidationPlugin } from '@univerjs/data-validation';
import { UniverDocsPlugin } from '@univerjs/docs';
import { UniverDocsUIPlugin } from '@univerjs/docs-ui';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverRenderEnginePlugin } from '@univerjs/engine-render';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverSheetsConditionalFormattingPlugin } from '@univerjs/sheets-conditional-formatting';
import { UniverSheetsConditionalFormattingUIPlugin } from '@univerjs/sheets-conditional-formatting-ui';
import { UniverSheetsDataValidationPlugin } from '@univerjs/sheets-data-validation';
import { UniverSheetsDataValidationUIPlugin } from '@univerjs/sheets-data-validation-ui';
import { UniverSheetsFilterPlugin } from '@univerjs/sheets-filter';
import { UniverSheetsFilterUIPlugin } from '@univerjs/sheets-filter-ui';
import { UniverSheetsFormulaPlugin } from '@univerjs/sheets-formula';
import { UniverSheetsFormulaUIPlugin } from '@univerjs/sheets-formula-ui';
import { UniverSheetsNumfmtPlugin } from '@univerjs/sheets-numfmt';
import { UniverSheetsNumfmtUIPlugin } from '@univerjs/sheets-numfmt-ui';
import { UniverSheetsUIPlugin } from '@univerjs/sheets-ui';
import { defaultTheme, type Theme } from '@univerjs/themes';
import { UniverUIPlugin } from '@univerjs/ui';
import designEnUS from '@univerjs/design/locale/en-US';
import docsUIEnUS from '@univerjs/docs-ui/locale/en-US';
import sheetsEnUS from '@univerjs/sheets/locale/en-US';
import sheetsConditionalFormattingUIEnUS from '@univerjs/sheets-conditional-formatting-ui/locale/en-US';
import sheetsDataValidationUIEnUS from '@univerjs/sheets-data-validation-ui/locale/en-US';
import sheetsFilterUIEnUS from '@univerjs/sheets-filter-ui/locale/en-US';
import sheetsFormulaEnUS from '@univerjs/sheets-formula/locale/en-US';
import sheetsFormulaUIEnUS from '@univerjs/sheets-formula-ui/locale/en-US';
import sheetsNumfmtUIEnUS from '@univerjs/sheets-numfmt-ui/locale/en-US';
import sheetsUIEnUS from '@univerjs/sheets-ui/locale/en-US';
import uiEnUS from '@univerjs/ui/locale/en-US';
import * as Y from 'yjs';
import { MemoryLocalStorageService } from './memory-storage';
import { withoutRemoteFunctions } from './remote-functions';
import { readTitle } from '@/lib/documents/content';
import { FORMULA_CODEC, toWorkbookData } from '@/lib/spreadsheets';

export const UNIVER_APP_VERSION = '1.0.3';

const HIDDEN_MENU_ITEMS = [
  'univer.command.undo',
  'univer.command.redo',
  'sheet.command.add-range-protection-from-toolbar',
  'sheet.command.add-range-protection-from-context-menu',
  'sheet.command.add-range-protection-from-sheet-bar',
  'sheet.command.set-range-protection-from-context-menu',
  'sheet.command.delete-range-protection-from-context-menu',
  'sheet.command.change-sheet-protection-from-sheet-bar',
  'sheet.command.delete-worksheet-protection-from-sheet-bar',
  'sheet.command.view-sheet-permission-from-context-menu',
  'sheet.command.view-sheet-permission-from-sheet-bar',
];
const BRAND_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

export function zekkeTheme(root: HTMLElement = document.documentElement): Theme {
  const styles = getComputedStyle(root);
  const primary = { ...defaultTheme.primary } as Record<number, string>;
  for (const step of BRAND_STEPS) {
    const value = styles.getPropertyValue(`--color-brand-${step}`).trim();
    if (value !== '') {
      primary[step] = value;
    }
  }
  return { ...defaultTheme, primary } as Theme;
}

export function startSpreadsheetUniver(container: HTMLElement, doc: Y.Doc, unitId: string): Univer {
  const univer = new Univer({
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: mergeLocales(
        designEnUS,
        uiEnUS,
        docsUIEnUS,
        sheetsEnUS,
        sheetsUIEnUS,
        sheetsFormulaEnUS,
        sheetsFormulaUIEnUS,
        sheetsNumfmtUIEnUS,
        sheetsFilterUIEnUS,
        sheetsDataValidationUIEnUS,
        sheetsConditionalFormattingUIEnUS,
      ),
    },
    theme: zekkeTheme(),
    logLevel: LogLevel.SILENT,
  });

  univer.registerPlugin(UniverDocsPlugin);
  univer.registerPlugin(UniverRenderEnginePlugin);
  univer.registerPlugin(UniverUIPlugin, {
    container,
    header: true,
    toolbar: true,
    footer: true,
    menu: Object.fromEntries(HIDDEN_MENU_ITEMS.map((id) => [id, { hidden: true }])),
    override: [[ILocalStorageService, { useClass: MemoryLocalStorageService }]],
  });
  univer.registerPlugin(UniverDocsUIPlugin);
  univer.registerPlugin(UniverFormulaEnginePlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverSheetsUIPlugin);
  univer.registerPlugin(UniverSheetsNumfmtPlugin);
  univer.registerPlugin(UniverSheetsNumfmtUIPlugin);
  univer.registerPlugin(UniverSheetsFormulaPlugin);
  univer.registerPlugin(UniverSheetsFormulaUIPlugin);
  univer.registerPlugin(UniverSheetsFilterPlugin);
  univer.registerPlugin(UniverSheetsFilterUIPlugin);
  univer.registerPlugin(UniverDataValidationPlugin);
  univer.registerPlugin(UniverSheetsDataValidationPlugin);
  univer.registerPlugin(UniverSheetsDataValidationUIPlugin);
  univer.registerPlugin(UniverSheetsConditionalFormattingPlugin);
  univer.registerPlugin(UniverSheetsConditionalFormattingUIPlugin);

  univer.createUnit(
    UniverInstanceType.UNIVER_SHEET,
    toWorkbookData(
      doc,
      { unitId, name: readTitle(doc), locale: LocaleType.EN_US, appVersion: UNIVER_APP_VERSION },
      FORMULA_CODEC,
    ),
  );
  withoutRemoteFunctions(univer);
  return univer;
}
