import {
  CellValueType,
  RegionService,
  InterceptorEffectEnum,
  getNumfmtParseValueFilter,
  isDefaultFormat,
  numfmt,
  type ICellData,
  type INumfmtLocaleTag,
  type IStyleData,
  type Nullable,
  type Univer,
  type Workbook,
  type Worksheet,
} from '@univerjs/core';
import { AFTER_CELL_EDIT, BEFORE_CELL_EDIT, INTERCEPTOR_POINT, SheetInterceptorService } from '@univerjs/sheets';
import { SheetsNumfmtCellContentController, localeCurrencySymbolMap } from '@univerjs/sheets-numfmt';
import {
  NUMBER_SEPARATORS,
  countryLocale,
  currencySymbol,
  formatPlainNumber,
  type SpreadsheetRegional,
} from '@/lib/regional';
import {
  canonicalizeFormula,
  localizeFormula,
  localizeNumber,
  type FormulaSyntax,
  type FunctionNames,
} from '@/lib/spreadsheets';

export const NUMFMT_CANDIDATES = [
  'en-US',
  'en-GB',
  'pt-BR',
  'de',
  'fr',
  'sv',
  'de-CH',
  'it',
  'es',
  'nl',
  'pt-PT',
  'ru',
  'pl',
] as const;

const AFTER_EDIT_PRIORITY = 10_000;
const BEFORE_EDIT_PRIORITY = -0.5;
const GENERAL_DISPLAY_PRIORITY = 1;
export const PREFERRED_REGION = 'zekke-preferred';

const PERCENT_TEXT = /^-?\d+(?:\.\d+)?%$/;

type DateOrder = 'dmy' | 'mdy' | 'ymd';

function dateOrder(pattern: string): DateOrder {
  return pattern.startsWith('yyyy') ? 'ymd' : pattern.startsWith('mm') ? 'mdy' : 'dmy';
}

function spaces(text: string): string {
  return text.replace(/[\s  ]/g, ' ');
}

function numfmtDateOrder(locale: string): DateOrder {
  const pattern = getNumfmtParseValueFilter('03/04/2026', { locale })?.z ?? '';
  return pattern.startsWith('mm') ? 'mdy' : 'dmy';
}

export function numfmtLocaleFor(regional: Pick<SpreadsheetRegional, 'country' | 'number' | 'date'>): string {
  const wanted = spaces(formatPlainNumber(1234567.891, regional.number === 'indian' ? 'comma-dot' : regional.number));
  const decimal = NUMBER_SEPARATORS[regional.number].decimal;
  const order = dateOrder(regional.date);
  const candidates = [countryLocale(regional.country), ...NUMFMT_CANDIDATES];
  let best = candidates[0];
  let bestScore = -1;
  for (const locale of candidates) {
    let written: string;
    try {
      written = spaces(numfmt.format('#,##0.00', 1234567.891, { locale }));
    } catch {
      continue;
    }
    const score =
      (written.endsWith(`${decimal}89`) ? 4 : 0) +
      (written === wanted ? 2 : 0) +
      (order === 'ymd' || numfmtDateOrder(locale) === order ? 1 : 0);
    if (score > bestScore) {
      best = locale;
      bestScore = score;
    }
  }
  return best;
}

export function formulaSyntaxFor(regional: Pick<SpreadsheetRegional, 'number'>, names?: FunctionNames): FormulaSyntax {
  const decimal = NUMBER_SEPARATORS[regional.number].decimal === ',' ? ',' : '.';
  return names === undefined ? { decimal } : { decimal, names };
}

function styleOf(workbook: Workbook, cell: Nullable<ICellData>): IStyleData | undefined {
  if (cell === null || cell === undefined || cell.s === null || cell.s === undefined) {
    return undefined;
  }
  return typeof cell.s === 'string' ? (workbook.getStyles().get(cell.s) ?? undefined) : cell.s;
}

function isRawNumber(cell: Nullable<ICellData>): cell is ICellData & { v: number } {
  return cell !== null && cell !== undefined && typeof cell.v === 'number' && (cell.t === CellValueType.NUMBER || cell.t === undefined || cell.t === null);
}

export function editorValue(
  cell: Nullable<ICellData>,
  raw: Nullable<ICellData>,
  generalFormat: boolean,
  syntax: FormulaSyntax,
): Nullable<ICellData> {
  if (cell === null || cell === undefined) {
    return cell;
  }
  if (typeof cell.f === 'string' && cell.f.startsWith('=')) {
    return { ...cell, f: localizeFormula(cell.f, syntax) };
  }
  if (typeof cell.v === 'number') {
    return { ...cell, v: localizeNumber(cell.v, syntax) };
  }
  if (typeof cell.v === 'string' && PERCENT_TEXT.test(cell.v)) {
    return { ...cell, v: syntax.decimal === ',' ? cell.v.replace('.', ',') : cell.v };
  }
  if (generalFormat && isRawNumber(raw) && !raw.f) {
    return { ...cell, v: localizeNumber(raw.v, syntax) };
  }
  return cell;
}

export function committedValue(cell: Nullable<ICellData>, syntax: FormulaSyntax): Nullable<ICellData> {
  if (cell === null || cell === undefined || typeof cell.f !== 'string' || !cell.f.startsWith('=')) {
    return cell;
  }
  return { ...cell, f: canonicalizeFormula(cell.f, syntax) };
}

export function generalDisplay(cell: ICellData, style: IStyleData | undefined, locale: string): ICellData {
  if (!isRawNumber(cell) || !isDefaultFormat(style?.n?.pattern)) {
    return cell;
  }
  return { ...cell, v: numfmt.format('General', cell.v, { locale }) };
}

export function applyRegionalSyntax(
  univer: Univer,
  regional: Pick<SpreadsheetRegional, 'country' | 'number' | 'date' | 'currency'>,
  names?: FunctionNames,
): () => void {
  const injector = univer.__getInjector();
  const interceptors = injector.get(SheetInterceptorService);
  const syntax = formulaSyntaxFor(regional, names);
  const locale = numfmtLocaleFor(regional);
  if (injector.has(SheetsNumfmtCellContentController)) {
    injector.get(SheetsNumfmtCellContentController).setNumfmtLocal(locale as INumfmtLocaleTag);
  }
  (localeCurrencySymbolMap as Map<string, string>).set(PREFERRED_REGION, currencySymbol(regional.currency, regional.country));
  if (injector.has(RegionService)) {
    injector.get(RegionService).setRegion(PREFERRED_REGION as never);
  }

  const generalFormat = (worksheet: Worksheet, workbook: Workbook, row: number, column: number) =>
    isDefaultFormat(styleOf(workbook, worksheet.getCellRaw(row, column))?.n?.pattern);

  if (syntax.decimal === '.' && syntax.names === undefined) {
    return () => undefined;
  }

  const stopBefore = interceptors.writeCellInterceptor.intercept(BEFORE_CELL_EDIT, {
    priority: BEFORE_EDIT_PRIORITY,
    handler: (cell, context, next) =>
      next(
        editorValue(
          cell,
          context.worksheet.getCellRaw(context.row, context.col),
          generalFormat(context.worksheet, context.workbook, context.row, context.col),
          syntax,
        ),
      ),
  });
  const stopAfter = interceptors.writeCellInterceptor.intercept(AFTER_CELL_EDIT, {
    priority: AFTER_EDIT_PRIORITY,
    handler: (cell, _context, next) => next(committedValue(cell, syntax)),
  });
  const display =
    syntax.decimal === ','
      ? interceptors.intercept(INTERCEPTOR_POINT.CELL_CONTENT, {
          effect: InterceptorEffectEnum.Value,
          priority: GENERAL_DISPLAY_PRIORITY,
          handler: (cell, location, next) =>
            next(cell === null || cell === undefined ? cell : generalDisplay(cell, styleOf(location.workbook, cell), locale)),
        })
      : undefined;

  return () => {
    stopBefore();
    stopAfter();
    display?.dispose();
  };
}
