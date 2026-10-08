import type * as ExcelJSNamespace from 'exceljs';
import {
  CONDITIONAL_FEATURE,
  FILTER_FEATURE,
  FILTER_RULE_KEY,
  VALIDATION_FEATURE,
  type FeatureRule,
} from './features';
import { columnIndex, columnLetters } from './formulas';
import { ELEMENT_ID_LENGTH, randomId } from './ids';
import type { GridRange } from './ranges';

type Worksheet = ExcelJSNamespace.Worksheet;

export const MAX_EXPORTED_VALIDATION_CELLS = 100_000;

export interface FeatureLosses {
  dataValidations: number;
  conditionalFormats: number;
}

export interface SheetBounds {
  rows: number;
  columns: number;
}

const VALIDATION_TYPES = new Set(['list', 'whole', 'decimal', 'date', 'time', 'textLength', 'custom']);
const NUMBER_OPERATORS = new Set([
  'between',
  'notBetween',
  'equal',
  'notEqual',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
]);
const EXCEL_ICON_SETS = new Set([
  '3Arrows',
  '3ArrowsGray',
  '3Flags',
  '3TrafficLights1',
  '3TrafficLights2',
  '3Signs',
  '3Symbols',
  '3Symbols2',
  '4Arrows',
  '4ArrowsGray',
  '4RedToBlack',
  '4Rating',
  '4TrafficLights',
  '5Arrows',
  '5ArrowsGray',
  '5Rating',
  '5Quarters',
]);
const VALUE_TYPES = new Set(['num', 'min', 'max', 'percent', 'percentile', 'formula']);
const ERROR_STYLES: Record<string, number> = { information: 0, stop: 1, warning: 2 };
const ERROR_STYLE_NAMES = ['information', 'stop', 'warning'] as const;
const COMPARISONS: Record<string, string> = {
  equal: '=',
  notEqual: '<>',
  greaterThan: '>',
  greaterThanOrEqual: '>=',
  lessThan: '<',
  lessThanOrEqual: '<=',
};
const TIME_PERIODS = new Set([
  'today',
  'yesterday',
  'tomorrow',
  'last7Days',
  'thisMonth',
  'lastMonth',
  'nextMonth',
  'thisWeek',
  'lastWeek',
  'nextWeek',
]);

type Loose = Record<string, unknown>;

function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function address(row: number, column: number): string {
  return `${columnLetters(column)}${row + 1}`;
}

function decodeCell(text: string): { row: number; column: number } | undefined {
  const match = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(text.trim());
  if (match === null) {
    return undefined;
  }
  return { row: Number(match[2]) - 1, column: columnIndex(match[1]) };
}

export function decodeReference(reference: string): GridRange | undefined {
  const [first, second = first] = reference.split(':');
  const start = decodeCell(first);
  const end = decodeCell(second);
  if (start === undefined || end === undefined) {
    return undefined;
  }
  return {
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endColumn: Math.max(start.column, end.column),
    rangeType: 0,
  };
}

function boundedRange(range: GridRange, bounds: SheetBounds): GridRange {
  const type = range.rangeType ?? 0;
  return {
    startRow: type === 2 || type === 3 ? 0 : range.startRow,
    endRow: type === 2 || type === 3 ? bounds.rows - 1 : range.endRow,
    startColumn: type === 1 || type === 3 ? 0 : range.startColumn,
    endColumn: type === 1 || type === 3 ? bounds.columns - 1 : range.endColumn,
  };
}

export function encodeReference(range: GridRange, bounds: SheetBounds, absolute = false): string {
  const bounded = boundedRange(range, bounds);
  const mark = absolute ? '$' : '';
  const start = `${mark}${columnLetters(bounded.startColumn)}${mark}${bounded.startRow + 1}`;
  const end = `${mark}${columnLetters(bounded.endColumn)}${mark}${bounded.endRow + 1}`;
  return start === end ? start : `${start}:${end}`;
}

export function cellsToRanges(cells: readonly { row: number; column: number }[]): GridRange[] {
  const byRow = new Map<number, number[]>();
  for (const { row, column } of cells) {
    const columns = byRow.get(row) ?? [];
    columns.push(column);
    byRow.set(row, columns);
  }
  const runs: { row: number; start: number; end: number }[] = [];
  for (const [row, columns] of [...byRow].sort(([a], [b]) => a - b)) {
    const sorted = [...new Set(columns)].sort((a, b) => a - b);
    let start = sorted[0];
    for (let index = 1; index <= sorted.length; index += 1) {
      if (index === sorted.length || sorted[index] !== sorted[index - 1] + 1) {
        runs.push({ row, start, end: sorted[index - 1] });
        start = sorted[index];
      }
    }
  }
  const open = new Map<string, GridRange>();
  const ranges: GridRange[] = [];
  for (const run of runs) {
    const key = `${run.start}:${run.end}`;
    const current = open.get(key);
    if (current !== undefined && current.endRow === run.row - 1) {
      current.endRow = run.row;
    } else {
      const range = { startRow: run.row, endRow: run.row, startColumn: run.start, endColumn: run.end, rangeType: 0 };
      open.set(key, range);
      ranges.push(range);
    }
  }
  return ranges;
}

function excelColor(color: unknown): string | undefined {
  const argb = isRecord(color) && typeof color.argb === 'string' ? color.argb : undefined;
  if (argb === undefined || !/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(argb)) {
    return undefined;
  }
  return `#${argb.slice(-6).toLowerCase()}`;
}

function argb(color: unknown): { argb: string } | undefined {
  return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? { argb: `FF${color.slice(1).toUpperCase()}` } : undefined;
}

function styleFromDxf(style: unknown): Loose {
  const result: Loose = {};
  if (!isRecord(style)) {
    return result;
  }
  const font = isRecord(style.font) ? style.font : {};
  if (font.bold === true) result.bl = 1;
  if (font.italic === true) result.it = 1;
  if (font.underline !== undefined && font.underline !== false && font.underline !== 'none') result.ul = { s: 1 };
  if (font.strike === true) result.st = { s: 1 };
  const color = excelColor(font.color);
  if (color !== undefined) result.cl = { rgb: color };
  const fill = isRecord(style.fill) ? style.fill : {};
  const background = excelColor(fill.bgColor) ?? excelColor(fill.fgColor);
  if (background !== undefined) result.bg = { rgb: background };
  return result;
}

function styleToDxf(style: unknown): Partial<ExcelJSNamespace.Style> {
  const result: Partial<ExcelJSNamespace.Style> = {};
  if (!isRecord(style)) {
    return result;
  }
  const font: Partial<ExcelJSNamespace.Font> = {};
  if (style.bl === 1) font.bold = true;
  if (style.it === 1) font.italic = true;
  if (isRecord(style.ul) && style.ul.s === 1) font.underline = true;
  if (isRecord(style.st) && style.st.s === 1) font.strike = true;
  const color = argb(isRecord(style.cl) ? style.cl.rgb : undefined);
  if (color !== undefined) font.color = color;
  if (Object.keys(font).length > 0) result.font = font;
  const background = argb(isRecord(style.bg) ? style.bg.rgb : undefined);
  if (background !== undefined) {
    result.fill = { type: 'pattern', pattern: 'solid', bgColor: background, fgColor: background };
  }
  return result;
}

function valueFromCfvo(cfvo: unknown): Loose | undefined {
  if (!isRecord(cfvo)) {
    return undefined;
  }
  const type = cfvo.type === 'autoMin' ? 'min' : cfvo.type === 'autoMax' ? 'max' : cfvo.type;
  if (typeof type !== 'string' || !VALUE_TYPES.has(type) || type === 'formula') {
    return undefined;
  }
  if (type === 'min' || type === 'max') {
    return { type };
  }
  return typeof cfvo.value === 'number' && Number.isFinite(cfvo.value) ? { type, value: cfvo.value } : undefined;
}

function cfvoFromValue(value: unknown): Loose | undefined {
  if (!isRecord(value) || typeof value.type !== 'string' || !VALUE_TYPES.has(value.type)) {
    return undefined;
  }
  if (value.type === 'min' || value.type === 'max') {
    return { type: value.type };
  }
  if (value.type === 'formula') {
    return typeof value.value === 'string' ? { type: 'formula', value: value.value.replace(/^=/, '') } : undefined;
  }
  const number = Number(value.value);
  return Number.isFinite(number) ? { type: value.type, value: number } : undefined;
}

function isNumeric(value: unknown): boolean {
  return (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
}

function validationFromExcel(model: Loose): Loose | undefined {
  const type = model.type;
  if (typeof type !== 'string' || !VALIDATION_TYPES.has(type)) {
    return undefined;
  }
  const formulae = Array.isArray(model.formulae) ? model.formulae : [];
  const formulas: string[] = [];
  for (const formula of formulae) {
    if (formula instanceof Date) {
      if (Number.isNaN(formula.getTime())) {
        return undefined;
      }
      formulas.push(formula.toISOString().slice(0, 10));
    } else if (typeof formula === 'number') {
      if (!Number.isFinite(formula)) {
        return undefined;
      }
      formulas.push(String(formula));
    } else if (typeof formula === 'string') {
      const quoted = /^"(.*)"$/s.exec(formula);
      formulas.push(quoted !== null ? quoted[1].replace(/""/g, '"') : `=${formula}`);
    }
  }
  const rule: Loose = { type };
  if (formulas[0] !== undefined) rule.formula1 = formulas[0];
  if (formulas[1] !== undefined) rule.formula2 = formulas[1];
  if (type !== 'list' && type !== 'custom' && typeof model.operator === 'string' && NUMBER_OPERATORS.has(model.operator)) {
    rule.operator = model.operator;
  }
  for (const key of ['allowBlank', 'showErrorMessage', 'showInputMessage'] as const) {
    if (model[key] === true) rule[key] = true;
  }
  for (const key of ['error', 'errorTitle', 'prompt', 'promptTitle'] as const) {
    if (typeof model[key] === 'string') rule[key] = model[key];
  }
  if (typeof model.errorStyle === 'string' && model.errorStyle in ERROR_STYLES) {
    rule.errorStyle = ERROR_STYLES[model.errorStyle];
  }
  return rule;
}

function validationToExcel(body: Loose): ExcelJSNamespace.DataValidation | undefined {
  const type = body.type === 'listMultiple' ? 'list' : body.type;
  if (typeof type !== 'string' || !VALIDATION_TYPES.has(type)) {
    return undefined;
  }
  const formulae: unknown[] = [];
  for (const key of ['formula1', 'formula2'] as const) {
    const formula = body[key];
    if (typeof formula !== 'string' || formula === '') {
      continue;
    }
    if (formula.startsWith('=')) {
      formulae.push(formula.slice(1));
    } else if (type === 'list') {
      formulae.push(`"${formula.replace(/"/g, '""')}"`);
    } else if (type === 'date') {
      const date = new Date(formula);
      if (Number.isNaN(date.getTime())) {
        return undefined;
      }
      formulae.push(date);
    } else if (isNumeric(formula)) {
      formulae.push(Number(formula));
    } else {
      formulae.push(formula);
    }
  }
  const validation: Loose = { type, formulae };
  if (typeof body.operator === 'string' && NUMBER_OPERATORS.has(body.operator)) validation.operator = body.operator;
  for (const key of ['allowBlank', 'showErrorMessage', 'showInputMessage'] as const) {
    if (body[key] === true) validation[key] = true;
  }
  for (const key of ['error', 'errorTitle', 'prompt', 'promptTitle'] as const) {
    if (typeof body[key] === 'string' && body[key] !== '') validation[key] = body[key];
  }
  if (typeof body.errorStyle === 'number' && ERROR_STYLE_NAMES[body.errorStyle] !== undefined) {
    validation.errorStyle = ERROR_STYLE_NAMES[body.errorStyle];
  }
  return validation as unknown as ExcelJSNamespace.DataValidation;
}

function topLeft(ranges: readonly GridRange[]): string {
  const first = ranges[0];
  return first === undefined ? 'A1' : address(first.startRow, first.startColumn);
}

function conditionalFromExcel(model: Loose, ranges: readonly GridRange[]): Loose | undefined {
  const style = styleFromDxf(model.style);
  const formulae = (Array.isArray(model.formulae) ? model.formulae : []).map((formula) => String(formula));
  const cell = topLeft(ranges);
  switch (model.type) {
    case 'expression':
      return formulae[0] === undefined ? undefined : { type: 'highlightCell', subType: 'formula', value: `=${formulae[0]}`, style };
    case 'cellIs': {
      const operator = typeof model.operator === 'string' ? model.operator : '';
      if (!NUMBER_OPERATORS.has(operator) || formulae.length === 0) {
        return undefined;
      }
      if (formulae.every(isNumeric)) {
        const value = operator === 'between' || operator === 'notBetween' ? [Number(formulae[0]), Number(formulae[1] ?? formulae[0])] : Number(formulae[0]);
        return { type: 'highlightCell', subType: 'number', operator, value, style };
      }
      const formula =
        operator === 'between'
          ? `=AND(${cell}>=${formulae[0]},${cell}<=${formulae[1] ?? formulae[0]})`
          : operator === 'notBetween'
            ? `=OR(${cell}<${formulae[0]},${cell}>${formulae[1] ?? formulae[0]})`
            : `=${cell}${COMPARISONS[operator]}${formulae[0]}`;
      return { type: 'highlightCell', subType: 'formula', value: formula, style };
    }
    case 'top10':
      return {
        type: 'highlightCell',
        subType: 'rank',
        isBottom: model.bottom === true,
        isPercent: model.percent === true,
        value: typeof model.rank === 'number' ? model.rank : 10,
        style,
      };
    case 'aboveAverage':
      return { type: 'highlightCell', subType: 'average', operator: model.aboveAverage === false ? 'lessThan' : 'greaterThan', style };
    case 'duplicateValues':
    case 'uniqueValues':
      return { type: 'highlightCell', subType: model.type, style };
    case 'colorScale': {
      const cfvo = Array.isArray(model.cfvo) ? model.cfvo : [];
      const colors = Array.isArray(model.color) ? model.color : [];
      const config = cfvo.map((entry, index) => ({ index, color: excelColor(colors[index]), value: valueFromCfvo(entry) }));
      return config.length >= 2 && config.every((step) => step.color !== undefined && step.value !== undefined)
        ? { type: 'colorScale', config }
        : undefined;
    }
    case 'dataBar': {
      const cfvo = Array.isArray(model.cfvo) ? model.cfvo : [];
      const min = valueFromCfvo(cfvo[0]);
      const max = valueFromCfvo(cfvo[1]);
      const color = excelColor(model.color);
      return min === undefined || max === undefined || color === undefined
        ? undefined
        : {
            type: 'dataBar',
            isShowValue: model.showValue !== false,
            config: { min, max, isGradient: model.gradient !== false, positiveColor: color, nativeColor: '#ff0000' },
          };
    }
    case 'iconSet': {
      const name = typeof model.iconSet === 'string' ? model.iconSet : '3TrafficLights1';
      const cfvo = Array.isArray(model.cfvo) ? model.cfvo : [];
      const values = cfvo.map(valueFromCfvo);
      if (cfvo.length < 3 || values.some((value) => value === undefined)) {
        return undefined;
      }
      const count = cfvo.length;
      const config = [];
      for (let index = 0; index < count; index += 1) {
        const threshold = index < count - 1 ? count - 1 - index : 1;
        const inclusive = (cfvo[threshold] as Loose).gte !== false;
        config.push({
          operator: index < count - 1 ? (inclusive ? 'greaterThanOrEqual' : 'greaterThan') : inclusive ? 'lessThan' : 'lessThanOrEqual',
          value: values[threshold],
          iconType: name,
          iconId: String(model.reverse === true ? count - 1 - index : index),
        });
      }
      return { type: 'iconSet', isShowValue: model.showValue !== false, config };
    }
  }
  return formulae[0] === undefined ? undefined : { type: 'highlightCell', subType: 'formula', value: `=${formulae[0]}`, style };
}

function textFormula(operator: unknown, text: string, cell: string): string | undefined {
  const quoted = `"${text.replace(/"/g, '""')}"`;
  switch (operator) {
    case 'containsText':
      return `NOT(ISERROR(SEARCH(${quoted},${cell})))`;
    case 'notContainsText':
      return `ISERROR(SEARCH(${quoted},${cell}))`;
    case 'beginsWith':
      return `LEFT(${cell},LEN(${quoted}))=${quoted}`;
    case 'endsWith':
      return `RIGHT(${cell},LEN(${quoted}))=${quoted}`;
    case 'equal':
      return `${cell}=${quoted}`;
    case 'notEqual':
      return `${cell}<>${quoted}`;
    case 'containsBlanks':
      return `LEN(TRIM(${cell}))=0`;
    case 'notContainsBlanks':
      return `LEN(TRIM(${cell}))>0`;
    case 'containsErrors':
      return `ISERROR(${cell})`;
    case 'notContainsErrors':
      return `NOT(ISERROR(${cell}))`;
  }
  return undefined;
}

function conditionalToExcel(body: Loose, ranges: readonly GridRange[], bounds: SheetBounds): Loose | undefined {
  const rule = isRecord(body.rule) ? body.rule : {};
  const style = styleToDxf(rule.style);
  const cell = topLeft(ranges.map((range) => boundedRange(range, bounds)));
  if (rule.type === 'highlightCell') {
    switch (rule.subType) {
      case 'formula':
        return typeof rule.value === 'string' ? { type: 'expression', formulae: [rule.value.replace(/^=/, '')], style } : undefined;
      case 'number': {
        if (typeof rule.operator !== 'string' || !NUMBER_OPERATORS.has(rule.operator)) {
          return undefined;
        }
        const values = Array.isArray(rule.value) ? rule.value : [rule.value];
        return values.every(isNumeric) ? { type: 'cellIs', operator: rule.operator, formulae: values.map(String), style } : undefined;
      }
      case 'text': {
        const formula = textFormula(rule.operator, typeof rule.value === 'string' ? rule.value : '', cell);
        return formula === undefined ? undefined : { type: 'expression', formulae: [formula], style };
      }
      case 'timePeriod':
        return typeof rule.operator === 'string' && TIME_PERIODS.has(rule.operator)
          ? { type: 'timePeriod', timePeriod: rule.operator, style }
          : undefined;
      case 'rank':
        return {
          type: 'top10',
          rank: typeof rule.value === 'number' ? rule.value : 10,
          percent: rule.isPercent === true,
          bottom: rule.isBottom === true,
          style,
        };
      case 'average':
        return {
          type: 'aboveAverage',
          aboveAverage: rule.operator !== 'lessThan' && rule.operator !== 'lessThanOrEqual',
          style,
        };
      case 'duplicateValues':
      case 'uniqueValues': {
        const whole = ranges.map((range) => encodeReference(range, bounds, true)).join(',');
        const comparison = rule.subType === 'duplicateValues' ? '>1' : '=1';
        return { type: 'expression', formulae: [`COUNTIF(${whole},${cell})${comparison}`], style };
      }
    }
    return undefined;
  }
  if (rule.type === 'colorScale' && Array.isArray(rule.config)) {
    const steps = [...rule.config].filter(isRecord).sort((a, b) => Number(a.index) - Number(b.index));
    const cfvo = steps.map((step) => cfvoFromValue(step.value));
    const color = steps.map((step) => argb(step.color));
    return cfvo.every(Boolean) && color.every(Boolean) && steps.length >= 2 ? { type: 'colorScale', cfvo, color } : undefined;
  }
  if (rule.type === 'dataBar' && isRecord(rule.config)) {
    const min = cfvoFromValue(rule.config.min);
    const max = cfvoFromValue(rule.config.max);
    const color = argb(rule.config.positiveColor);
    return min === undefined || max === undefined || color === undefined
      ? undefined
      : { type: 'dataBar', cfvo: [min, max], color, gradient: rule.config.isGradient !== false, showValue: rule.isShowValue !== false };
  }
  if (rule.type === 'iconSet' && Array.isArray(rule.config) && rule.config.length >= 3) {
    const config = rule.config.filter(isRecord);
    const name = config[0]?.iconType;
    if (typeof name !== 'string' || !EXCEL_ICON_SETS.has(name) || config.some((step) => step.iconType !== name)) {
      return undefined;
    }
    const count = config.length;
    const reverse = config[0].iconId !== '0';
    const thresholds = [];
    for (let index = count - 2; index >= 0; index -= 1) {
      const value = cfvoFromValue(config[index].value);
      if (value === undefined) {
        return undefined;
      }
      thresholds.push({ ...value, gte: config[index].operator !== 'greaterThan' });
    }
    return { type: 'iconSet', iconSet: name, reverse, showValue: rule.isShowValue !== false, cfvo: [{ type: 'percent', value: 0 }, ...thresholds] };
  }
  return undefined;
}

export function featuresFromExcel(sheet: Worksheet, losses: FeatureLosses): FeatureRule[] {
  const rules: FeatureRule[] = [];

  const validations = (sheet as unknown as { dataValidations?: { model?: Record<string, unknown> } }).dataValidations?.model ?? {};
  const groups = new Map<unknown, { row: number; column: number }[]>();
  for (const [key, model] of Object.entries(validations)) {
    const cell = decodeCell(key);
    if (cell === undefined || !isRecord(model)) {
      continue;
    }
    const cells = groups.get(model) ?? [];
    cells.push(cell);
    groups.set(model, cells);
  }
  let validationOrder = 0;
  for (const [model, cells] of groups) {
    const body = validationFromExcel(model as Loose);
    if (body === undefined) {
      if ((model as Loose).type !== 'any') losses.dataValidations += 1;
      continue;
    }
    rules.push({ id: randomId(ELEMENT_ID_LENGTH), feature: VALIDATION_FEATURE, ranges: cellsToRanges(cells), body, order: validationOrder });
    validationOrder += 1;
  }

  const formattings = (sheet as unknown as { conditionalFormattings?: { ref?: string; rules?: unknown[] }[] }).conditionalFormattings ?? [];
  const conditionals: { priority: number; rule: FeatureRule }[] = [];
  for (const formatting of formattings) {
    const ranges = (formatting.ref ?? '')
      .split(/\s+/)
      .map(decodeReference)
      .filter((range): range is GridRange => range !== undefined);
    for (const model of formatting.rules ?? []) {
      const rule = isRecord(model) && ranges.length > 0 ? conditionalFromExcel(model, ranges) : undefined;
      if (rule === undefined) {
        losses.conditionalFormats += 1;
        continue;
      }
      conditionals.push({
        priority: isRecord(model) && typeof model.priority === 'number' ? model.priority : Number.MAX_SAFE_INTEGER,
        rule: {
          id: randomId(ELEMENT_ID_LENGTH),
          feature: CONDITIONAL_FEATURE,
          ranges,
          body: { stopIfTrue: isRecord(model) && model.stopIfTrue === true, rule },
          order: 0,
        },
      });
    }
  }
  conditionals
    .sort((a, b) => a.priority - b.priority)
    .forEach(({ rule }, order) => rules.push({ ...rule, order }));

  const autoFilter = sheet.autoFilter as unknown;
  const reference =
    typeof autoFilter === 'string'
      ? autoFilter
      : isRecord(autoFilter) && typeof autoFilter.from === 'string' && typeof autoFilter.to === 'string'
        ? `${autoFilter.from}:${autoFilter.to}`
        : undefined;
  const filterRange = reference === undefined ? undefined : decodeReference(reference);
  if (filterRange !== undefined) {
    rules.push({ id: FILTER_RULE_KEY, feature: FILTER_FEATURE, ranges: [filterRange], body: { filterColumns: [] }, order: 0 });
  }
  return rules;
}

export function featuresToExcel(sheet: Worksheet, rules: readonly FeatureRule[], bounds: SheetBounds): FeatureLosses {
  const losses: FeatureLosses = { dataValidations: 0, conditionalFormats: 0 };
  let validationCells = 0;
  const ordered = [...rules].sort((a, b) => a.order - b.order);

  for (const rule of ordered.filter(({ feature }) => feature === VALIDATION_FEATURE)) {
    const validation = isRecord(rule.body) ? validationToExcel(rule.body) : undefined;
    const ranges = rule.ranges.map((range) => boundedRange(range, bounds));
    const cells = ranges.reduce((total, range) => total + (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1), 0);
    if (validation === undefined || validationCells + cells > MAX_EXPORTED_VALIDATION_CELLS) {
      losses.dataValidations += 1;
      continue;
    }
    validationCells += cells;
    const target = (sheet as unknown as { dataValidations: { add(address: string, validation: ExcelJSNamespace.DataValidation): void } })
      .dataValidations;
    for (const range of ranges) {
      for (let row = range.startRow; row <= range.endRow; row += 1) {
        for (let column = range.startColumn; column <= range.endColumn; column += 1) {
          target.add(address(row, column), validation);
        }
      }
    }
  }

  let priority = 1;
  for (const rule of ordered.filter(({ feature }) => feature === CONDITIONAL_FEATURE)) {
    const converted = isRecord(rule.body) ? conditionalToExcel(rule.body, rule.ranges, bounds) : undefined;
    if (converted === undefined) {
      losses.conditionalFormats += 1;
      continue;
    }
    sheet.addConditionalFormatting({
      ref: rule.ranges.map((range) => encodeReference(range, bounds)).join(' '),
      rules: [{ ...converted, priority } as unknown as ExcelJSNamespace.ConditionalFormattingRule],
    });
    priority += 1;
  }

  const filter = ordered.find(({ feature }) => feature === FILTER_FEATURE);
  if (filter?.ranges[0] !== undefined) {
    sheet.autoFilter = encodeReference(filter.ranges[0], bounds);
  }
  return losses;
}
