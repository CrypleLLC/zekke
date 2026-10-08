import { readAxis } from './axis';
import { anchorRange, toGridRange, type GridRange, type IdRange } from './ranges';
import { readRules, type SheetRule } from './rules';
import { rulesMap } from './layout';
import { readSheet, readSheets } from './sheets';
import { WorkbookIndex, type FormulaCodec, type SheetAxes } from './workbook';
import type * as Y from 'yjs';

export const FILTER_FEATURE = 'filter';
export const VALIDATION_FEATURE = 'data-validation';
export const CONDITIONAL_FEATURE = 'conditional-format';

export const BOUND_FEATURES = [FILTER_FEATURE, VALIDATION_FEATURE, CONDITIONAL_FEATURE] as const;
export type BoundFeature = (typeof BOUND_FEATURES)[number];

export const FILTER_RULE_ID = 'filter:sheet';
const ITEM_PREFIX: Record<Exclude<BoundFeature, typeof FILTER_FEATURE>, string> = {
  [VALIDATION_FEATURE]: 'dv:',
  [CONDITIONAL_FEATURE]: 'cf:',
};

export const FEATURE_ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isBoundFeature(value: unknown): value is BoundFeature {
  return typeof value === 'string' && (BOUND_FEATURES as readonly string[]).includes(value);
}

export function featureRuleId(feature: BoundFeature, itemId?: string): string | undefined {
  if (feature === FILTER_FEATURE) {
    return FILTER_RULE_ID;
  }
  return itemId !== undefined && FEATURE_ITEM_ID.test(itemId) ? ITEM_PREFIX[feature] + itemId : undefined;
}

export function featureItemId(feature: BoundFeature, ruleId: string): string | undefined {
  if (feature === FILTER_FEATURE) {
    return ruleId === FILTER_RULE_ID ? FILTER_RULE_ID : undefined;
  }
  const prefix = ITEM_PREFIX[feature];
  const itemId = ruleId.startsWith(prefix) ? ruleId.slice(prefix.length) : undefined;
  return itemId !== undefined && FEATURE_ITEM_ID.test(itemId) ? itemId : undefined;
}

type FormulaMap = (formula: string) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFormula(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('=') && value.length > 1;
}

function mapValueConfig(config: unknown, map: FormulaMap): unknown {
  if (!isRecord(config) || config.type !== 'formula' || !isFormula(config.value)) {
    return config;
  }
  return { ...config, value: map(config.value) };
}

function mapConditionalRule(rule: Record<string, unknown>, map: FormulaMap): Record<string, unknown> {
  if (rule.type === 'highlightCell' && rule.subType === 'formula' && isFormula(rule.value)) {
    return { ...rule, value: map(rule.value) };
  }
  if (rule.type === 'dataBar' && isRecord(rule.config)) {
    return {
      ...rule,
      config: { ...rule.config, min: mapValueConfig(rule.config.min, map), max: mapValueConfig(rule.config.max, map) },
    };
  }
  if ((rule.type === 'colorScale' || rule.type === 'iconSet') && Array.isArray(rule.config)) {
    return {
      ...rule,
      config: rule.config.map((step) => (isRecord(step) ? { ...step, value: mapValueConfig(step.value, map) } : step)),
    };
  }
  return rule;
}

export function mapRuleFormulas(feature: BoundFeature, body: unknown, map: FormulaMap): unknown {
  if (!isRecord(body)) {
    return body;
  }
  if (feature === VALIDATION_FEATURE) {
    const mapped = { ...body };
    for (const key of ['formula1', 'formula2'] as const) {
      if (isFormula(mapped[key])) {
        mapped[key] = map(mapped[key]);
      }
    }
    return mapped;
  }
  if (feature === CONDITIONAL_FEATURE && isRecord(body.rule)) {
    return { ...body, rule: mapConditionalRule(body.rule, map) };
  }
  return body;
}

export interface StoredFilterColumn {
  column: string;
  criteria: Record<string, unknown>;
}

export function filterBody(
  filterColumns: unknown,
  columnId: (index: number) => string | undefined,
): { columns: StoredFilterColumn[] } {
  const columns: StoredFilterColumn[] = [];
  for (const entry of Array.isArray(filterColumns) ? filterColumns : []) {
    if (!isRecord(entry) || typeof entry.colId !== 'number') {
      continue;
    }
    const id = columnId(entry.colId);
    if (id === undefined) {
      continue;
    }
    const { colId: _colId, ...criteria } = entry;
    columns.push({ column: id, criteria });
  }
  return { columns: columns.sort((a, b) => (a.column < b.column ? -1 : a.column > b.column ? 1 : 0)) };
}

export function filterColumns(
  body: unknown,
  columnIndex: (id: string) => number | undefined,
): { colId: number; criteria: Record<string, unknown> }[] {
  const columns = isRecord(body) && Array.isArray(body.columns) ? body.columns : [];
  const resolved: { colId: number; criteria: Record<string, unknown> }[] = [];
  for (const entry of columns) {
    if (!isRecord(entry) || typeof entry.column !== 'string' || !isRecord(entry.criteria)) {
      continue;
    }
    const colId = columnIndex(entry.column);
    if (colId !== undefined) {
      resolved.push({ colId, criteria: entry.criteria });
    }
  }
  return resolved.sort((a, b) => a.colId - b.colId);
}

export interface FeatureRule {
  id: string;
  feature: BoundFeature;
  ranges: GridRange[];
  body: unknown;
  order: number;
}


export interface FormulaContext {
  codec: FormulaCodec;
  workbook: WorkbookIndex;
  sheetId: string;
}

export function plainRange(range: GridRange): GridRange {
  const type = range.rangeType ?? 0;
  return {
    startRow: type === 2 || type === 3 ? 0 : range.startRow,
    endRow: type === 2 || type === 3 ? 0 : range.endRow,
    startColumn: type === 1 || type === 3 ? 0 : range.startColumn,
    endColumn: type === 1 || type === 3 ? 0 : range.endColumn,
    rangeType: type,
  };
}

export function featureScope(context: FormulaContext, ranges: readonly GridRange[]) {
  const first = ranges[0];
  return {
    sheetId: context.sheetId,
    row: first === undefined || first.rangeType === 2 || first.rangeType === 3 ? 0 : first.startRow,
    column: first === undefined || first.rangeType === 1 || first.rangeType === 3 ? 0 : first.startColumn,
    workbook: context.workbook,
  };
}

export const FILTER_RULE_KEY = 'filter';

export function storedFeatureRule(
  rule: FeatureRule,
  axes: SheetAxes,
  context: FormulaContext,
): { id: string; rule: SheetRule } | undefined {
  const id = featureRuleId(rule.feature, rule.id);
  if (id === undefined) {
    return undefined;
  }
  const ranges = rule.ranges
    .map((range) => anchorRange(range, axes.rows, axes.columns))
    .filter((range): range is IdRange => range !== undefined);
  if (ranges.length === 0) {
    return undefined;
  }
  const body =
    rule.feature === FILTER_FEATURE
      ? filterBody((rule.body as { filterColumns?: unknown }).filterColumns, (index) => axes.columns.idAt(index))
      : mapRuleFormulas(rule.feature, rule.body, (formula) => context.codec.store(formula, featureScope(context, rule.ranges)));
  return { id, rule: { feature: rule.feature, ranges, body, order: rule.order } };
}

export function featureRulesFromDoc(
  doc: Y.Doc,
  sheetId: string,
  feature: BoundFeature,
  codec: FormulaCodec,
): FeatureRule[] {
  const sheet = readSheet(doc, sheetId);
  if (sheet === undefined) {
    return [];
  }
  const columns = readAxis(sheet, 'columns');
  const context = { codec, workbook: new WorkbookIndex(doc), sheetId };
  return readRules(sheet, feature).flatMap((stored) => {
    const id = featureItemId(feature, stored.id);
    if (id === undefined) {
      return [];
    }
    const ranges = stored.ranges.map((range) => plainRange(toGridRange(range)));
    const body =
      feature === FILTER_FEATURE
        ? { filterColumns: filterColumns(stored.body, (column) => columns.indexOf(column)).map(({ colId, criteria }) => ({ ...criteria, colId })) }
        : mapRuleFormulas(feature, stored.body, (formula) => codec.display(formula, featureScope(context, ranges)));
    return [{ id: feature === FILTER_FEATURE ? FILTER_RULE_KEY : id, feature, ranges, body, order: stored.order }];
  });
}


export function writeFeatureRules(doc: Y.Doc, sheetId: string, rules: readonly FeatureRule[], codec: FormulaCodec): number {
  const sheet = readSheet(doc, sheetId);
  if (sheet === undefined) {
    return 0;
  }
  const axes = { rows: readAxis(sheet, 'rows'), columns: readAxis(sheet, 'columns') };
  const context = { codec, workbook: new WorkbookIndex(doc), sheetId };
  let written = 0;
  doc.transact(() => {
    for (const rule of rules) {
      const stored = storedFeatureRule(rule, axes, context);
      if (stored !== undefined) {
        rulesMap(sheet).set(stored.id, stored.rule);
        written += 1;
      }
    }
  });
  return written;
}

export function featureRulesOfWorkbook(doc: Y.Doc, codec: FormulaCodec): Record<string, FeatureRule[]> {
  return Object.fromEntries(
    readSheets(doc).map(({ id }) => [id, BOUND_FEATURES.flatMap((feature) => featureRulesFromDoc(doc, id, feature, codec))]),
  );
}
