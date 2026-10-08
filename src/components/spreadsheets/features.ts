import type { IRange, Univer } from '@univerjs/core';
import { DataValidationModel } from '@univerjs/data-validation';
import { ConditionalFormattingRuleModel } from '@univerjs/sheets-conditional-formatting';
import { SheetsFilterService } from '@univerjs/sheets-filter';
import type * as Y from 'yjs';
import {
  BOUND_FEATURES,
  CONDITIONAL_FEATURE,
  FILTER_FEATURE,
  FILTER_RULE_KEY,
  VALIDATION_FEATURE,
  canonicalJson,
  featureRuleId,
  featureRulesFromDoc,
  isBoundFeature,
  isIdRange,
  plainRange,
  readAxis,
  readSheet,
  resolveRange,
  rulesMap,
  storedFeatureRule,
  toGridRange,
  type BoundFeature,
  type FeatureRule,
  type FormulaCodec,
  type GridRange,
  type IdRange,
  type Operation,
  type SheetAxes,
  type WorkbookIndex,
} from '@/lib/spreadsheets';
import type { UniverSurface } from './surface';

export const FEATURE_MUTATIONS: Record<string, BoundFeature> = {
  'sheet.mutation.set-filter-range': FILTER_FEATURE,
  'sheet.mutation.set-filter-criteria': FILTER_FEATURE,
  'sheet.mutation.remove-filter': FILTER_FEATURE,
  'sheet.mutation.re-calc-filter': FILTER_FEATURE,
  'data-validation.mutation.addRule': VALIDATION_FEATURE,
  'data-validation.mutation.removeRule': VALIDATION_FEATURE,
  'data-validation.mutation.updateRule': VALIDATION_FEATURE,
  'sheet.mutation.add-conditional-rule': CONDITIONAL_FEATURE,
  'sheet.mutation.delete-conditional-rule': CONDITIONAL_FEATURE,
  'sheet.mutation.set-conditional-rule': CONDITIONAL_FEATURE,
  'sheet.mutation.move-conditional-rule': CONDITIONAL_FEATURE,
};

export class FeatureModels {
  private readonly filters: SheetsFilterService | undefined;
  private readonly validations: DataValidationModel | undefined;
  private readonly conditionals: ConditionalFormattingRuleModel | undefined;

  constructor(
    univer: Univer,
    private readonly surface: UniverSurface,
  ) {
    const injector = univer.__getInjector();
    this.filters = injector.has(SheetsFilterService) ? injector.get(SheetsFilterService) : undefined;
    this.validations = injector.has(DataValidationModel) ? injector.get(DataValidationModel) : undefined;
    this.conditionals = injector.has(ConditionalFormattingRuleModel)
      ? injector.get(ConditionalFormattingRuleModel)
      : undefined;
  }

  bound(feature: BoundFeature): boolean {
    switch (feature) {
      case FILTER_FEATURE:
        return this.filters !== undefined;
      case VALIDATION_FEATURE:
        return this.validations !== undefined;
      case CONDITIONAL_FEATURE:
        return this.conditionals !== undefined;
    }
  }

  read(sheetId: string, feature: BoundFeature): FeatureRule[] {
    const unitId = this.surface.unitId;
    switch (feature) {
      case FILTER_FEATURE: {
        const model = this.filters?.getFilterModel(unitId, sheetId);
        const range = model?.getRange();
        if (model === undefined || model === null || range === undefined || range === null) {
          return [];
        }
        const { filterColumns: columns } = model.serialize();
        return [{ id: FILTER_RULE_KEY, feature, ranges: [plainRange(range)], body: { filterColumns: columns }, order: 0 }];
      }
      case VALIDATION_FEATURE:
        return (this.validations?.getRules(unitId, sheetId) ?? []).flatMap((rule, order) => {
          const { uid, ranges, ...body } = rule as unknown as Record<string, unknown> & { uid: string; ranges: IRange[] };
          return featureRuleId(feature, uid) === undefined
            ? []
            : [{ id: uid, feature, ranges: ranges.map(plainRange), body, order }];
        });
      case CONDITIONAL_FEATURE:
        return (this.conditionals?.getSubunitRules(unitId, sheetId) ?? []).flatMap((rule, order) =>
          featureRuleId(feature, rule.cfId) === undefined
            ? []
            : [
                {
                  id: rule.cfId,
                  feature,
                  ranges: rule.ranges.map(plainRange),
                  body: { stopIfTrue: rule.stopIfTrue, rule: rule.rule },
                  order,
                },
              ],
        );
    }
  }

  write(sheetId: string, feature: BoundFeature, current: readonly FeatureRule[], target: readonly FeatureRule[]): void {
    const { surface } = this;
    const base = { unitId: surface.unitId, subUnitId: sheetId };
    switch (feature) {
      case FILTER_FEATURE: {
        if (current.length > 0) {
          surface.apply('sheet.mutation.remove-filter', base);
        }
        const filter = target[0];
        if (filter === undefined) {
          return;
        }
        surface.apply('sheet.mutation.set-filter-range', { ...base, range: filter.ranges[0] });
        for (const column of (filter.body as { filterColumns: { colId: number }[] }).filterColumns) {
          surface.apply('sheet.mutation.set-filter-criteria', { ...base, col: column.colId, criteria: column });
        }
        return;
      }
      case VALIDATION_FEATURE:
        if (current.length > 0) {
          surface.apply('data-validation.mutation.removeRule', { ...base, ruleId: current.map(({ id }) => id) });
        }
        target.forEach((rule, index) => {
          surface.apply('data-validation.mutation.addRule', {
            ...base,
            index,
            rule: { ...(rule.body as object), uid: rule.id, ranges: rule.ranges },
          });
        });
        return;
      case CONDITIONAL_FEATURE:
        for (const rule of current) {
          surface.apply('sheet.mutation.delete-conditional-rule', { ...base, cfId: rule.id });
        }
        for (const rule of [...target].reverse()) {
          const body = rule.body as { stopIfTrue?: boolean; rule: unknown };
          surface.apply('sheet.mutation.add-conditional-rule', {
            ...base,
            rule: { cfId: rule.id, ranges: rule.ranges, stopIfTrue: body.stopIfTrue === true, rule: body.rule },
          });
        }
        return;
    }
  }
}

function comparable(rules: readonly FeatureRule[]): string {
  return canonicalJson(
    [...rules]
      .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(({ id, ranges, body }) => ({ id, ranges: ranges.map(plainRange), body })),
  );
}

export function reconcileFeatures(models: FeatureModels, doc: Y.Doc, sheetId: string, codec: FormulaCodec): boolean {
  let changed = false;
  for (const feature of BOUND_FEATURES) {
    if (!models.bound(feature)) {
      continue;
    }
    const target = featureRulesFromDoc(doc, sheetId, feature, codec);
    const current = models.read(sheetId, feature);
    if (comparable(target) !== comparable(current)) {
      models.write(sheetId, feature, current, target);
      changed = true;
    }
  }
  return changed;
}

function resolvesTo(stored: unknown, ranges: readonly GridRange[], axes: SheetAxes): stored is { ranges: IdRange[] } {
  const storedRanges = (stored as { ranges?: unknown } | undefined)?.ranges;
  if (!Array.isArray(storedRanges) || !storedRanges.every(isIdRange) || storedRanges.length !== ranges.length) {
    return false;
  }
  return storedRanges.every((range, index) => {
    const resolved = resolveRange(range, axes.rows, axes.columns);
    return resolved !== undefined && canonicalJson(plainRange(toGridRange(resolved))) === canonicalJson(plainRange(ranges[index]));
  });
}

export function captureFeature(
  models: FeatureModels,
  doc: Y.Doc,
  sheetId: string,
  feature: BoundFeature,
  workbook: WorkbookIndex,
  codec: FormulaCodec,
): Operation[] {
  const sheet = readSheet(doc, sheetId);
  if (sheet === undefined) {
    return [];
  }
  const axes = { rows: readAxis(sheet, 'rows'), columns: readAxis(sheet, 'columns') };
  const context = { codec, workbook, sheetId };
  const existing = new Map<string, unknown>();
  rulesMap(sheet).forEach((stored, id) => {
    if (typeof stored === 'object' && stored !== null && (stored as { feature?: unknown }).feature === feature) {
      existing.set(id, stored);
    }
  });
  const operations: Operation[] = [];
  const kept = new Set<string>();
  for (const rule of models.read(sheetId, feature)) {
    const stored = storedFeatureRule(rule, axes, context);
    if (stored === undefined) {
      continue;
    }
    kept.add(stored.id);
    const previous = existing.get(stored.id);
    if (resolvesTo(previous, rule.ranges, axes)) {
      stored.rule.ranges = previous.ranges;
    }
    if (canonicalJson(previous) !== canonicalJson(stored.rule)) {
      operations.push({ kind: 'rule', sheetId, id: stored.id, rule: stored.rule });
    }
  }
  for (const id of existing.keys()) {
    if (!kept.has(id)) {
      operations.push({ kind: 'rule', sheetId, id });
    }
  }
  return operations;
}

export function featureOfMutation(id: string): BoundFeature | undefined {
  const feature = FEATURE_MUTATIONS[id];
  return isBoundFeature(feature) ? feature : undefined;
}
