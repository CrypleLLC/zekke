import { readAxis } from './axis';
import { ELEMENT_ID_LENGTH, freshIds } from './ids';
import { mergesMap, rulesMap, type SheetMap } from './layout';
import { anchorRange, isIdRange, resolveRange, type GridRange, type IdRange, type IndexRange } from './ranges';

export interface SheetRule {
  feature: string;
  ranges: IdRange[];
  body: unknown;
  order: number;
}

export interface ResolvedRule {
  id: string;
  feature: string;
  ranges: IndexRange[];
  body: unknown;
  order: number;
}

function transact(sheet: SheetMap, change: () => void, origin?: unknown): void {
  if (sheet.doc === null) {
    change();
  } else {
    sheet.doc.transact(change, origin);
  }
}

export function addMerge(sheet: SheetMap, range: GridRange, origin?: unknown): string | undefined {
  const anchored = anchorRange(range, readAxis(sheet, 'rows'), readAxis(sheet, 'columns'));
  if (anchored === undefined) {
    return undefined;
  }
  const merges = mergesMap(sheet);
  const id = freshIds(1, ELEMENT_ID_LENGTH, new Set(merges.keys()))[0];
  transact(sheet, () => merges.set(id, anchored), origin);
  return id;
}

export function removeMergesWithin(sheet: SheetMap, range: GridRange, origin?: unknown): string[] {
  const removed = readMerges(sheet)
    .filter(({ range: merge }) => overlaps(merge, range))
    .map(({ id }) => id);
  transact(
    sheet,
    () => {
      for (const id of removed) {
        mergesMap(sheet).delete(id);
      }
    },
    origin,
  );
  return removed;
}

export function readMerges(sheet: SheetMap): { id: string; range: IndexRange }[] {
  const rows = readAxis(sheet, 'rows');
  const columns = readAxis(sheet, 'columns');
  const merges: { id: string; range: IndexRange }[] = [];
  mergesMap(sheet).forEach((stored, id) => {
    if (!isIdRange(stored)) {
      return;
    }
    const range = resolveRange(stored, rows, columns);
    if (range === undefined || (range.startRow === range.endRow && range.startColumn === range.endColumn)) {
      return;
    }
    merges.push({ id, range });
  });
  return dropOverlappingMerges(merges);
}

function dropOverlappingMerges(merges: { id: string; range: IndexRange }[]): { id: string; range: IndexRange }[] {
  const kept: { id: string; range: IndexRange }[] = [];
  for (const merge of [...merges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!kept.some((other) => overlaps(other.range, merge.range))) {
      kept.push(merge);
    }
  }
  return kept;
}

function overlaps(a: GridRange, b: GridRange): boolean {
  return (
    a.startRow <= b.endRow && b.startRow <= a.endRow && a.startColumn <= b.endColumn && b.startColumn <= a.endColumn
  );
}

export function writeRule(
  sheet: SheetMap,
  rule: { id?: string; feature: string; ranges: GridRange[]; body: unknown; order?: number },
  origin?: unknown,
): string {
  const rows = readAxis(sheet, 'rows');
  const columns = readAxis(sheet, 'columns');
  const rules = rulesMap(sheet);
  const id = rule.id ?? freshIds(1, ELEMENT_ID_LENGTH, new Set(rules.keys()))[0];
  const stored: SheetRule = {
    feature: rule.feature,
    ranges: rule.ranges
      .map((range) => anchorRange(range, rows, columns))
      .filter((range): range is IdRange => range !== undefined),
    body: rule.body,
    order: rule.order ?? 0,
  };
  transact(sheet, () => rules.set(id, stored), origin);
  return id;
}

export function removeRule(sheet: SheetMap, id: string, origin?: unknown): void {
  transact(sheet, () => rulesMap(sheet).delete(id), origin);
}

export function readRules(sheet: SheetMap, feature?: string): ResolvedRule[] {
  const rows = readAxis(sheet, 'rows');
  const columns = readAxis(sheet, 'columns');
  const resolved: ResolvedRule[] = [];
  rulesMap(sheet).forEach((stored, id) => {
    if (!isSheetRule(stored) || (feature !== undefined && stored.feature !== feature)) {
      return;
    }
    const ranges = stored.ranges
      .map((range) => resolveRange(range, rows, columns))
      .filter((range): range is IndexRange => range !== undefined);
    if (ranges.length === 0) {
      return;
    }
    resolved.push({ id, feature: stored.feature, ranges, body: stored.body, order: stored.order });
  });
  return resolved.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function isSheetRule(value: unknown): value is SheetRule {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const rule = value as Record<string, unknown>;
  return (
    typeof rule.feature === 'string' &&
    typeof rule.order === 'number' &&
    Array.isArray(rule.ranges) &&
    rule.ranges.every(isIdRange)
  );
}
