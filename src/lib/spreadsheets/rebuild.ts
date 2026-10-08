import * as Y from 'yjs';
import { insertLineIds, readAxis, type Axis } from './axis';
import { CHART_FEATURE, anchorChart, resolveAnchor, type StoredAnchor } from './charts';
import { CONDITIONAL_FEATURE, FILTER_FEATURE, VALIDATION_FEATURE, mapRuleFormulas } from './features';
import { FORMULA_CODEC } from './formulas';
import {
  LINE_PROPERTY_PREFIX,
  LINE_STYLE,
  META_MAP,
  REPLACED_BY_FIELD,
  SHEET_COLUMNS,
  SHEET_COLUMN_ORDER,
  SHEET_MERGES,
  SHEET_REMOVED_COLUMNS,
  SHEET_REMOVED_ROWS,
  SHEET_ROWS,
  SHEET_ROW_ORDER,
  SHEET_RULES,
  STYLE_KEY_PREFIX,
  isCellKey,
  linesMap,
  mergesMap,
  namesMap,
  newSheetMap,
  rulesMap,
  sheetOrderArray,
  sheetsMap,
  stylesMap,
  type Dimension,
  type SheetMap,
} from './layout';
import { isStoredName } from './names';
import { anchorRange, isIdRange, resolveRange, toGridRange, type IdRange } from './ranges';
import { readMerges } from './rules';
import { readSheets, readSheetName } from './sheets';
import { WorkbookIndex, type FormulaCodec, type FormulaScope } from './workbook';

const STRUCTURAL_KEYS = new Set([
  SHEET_ROW_ORDER,
  SHEET_COLUMN_ORDER,
  SHEET_REMOVED_ROWS,
  SHEET_REMOVED_COLUMNS,
  SHEET_ROWS,
  SHEET_COLUMNS,
  SHEET_MERGES,
  SHEET_RULES,
]);

const FORMULA_FEATURES = new Set<string>([VALIDATION_FEATURE, CONDITIONAL_FEATURE]);

interface SheetPair {
  id: string;
  source: SheetMap;
  target: SheetMap;
  rows: Axis;
  columns: Axis;
}

function plain(value: unknown): unknown {
  return value instanceof Y.AbstractType ? value.toJSON() : value;
}

function isFormulaContent(value: unknown): value is { f: string } {
  return typeof value === 'object' && value !== null && typeof (value as { f?: unknown }).f === 'string';
}

export function rebuildSpreadsheet(source: Y.Doc, codec: FormulaCodec = FORMULA_CODEC): Y.Doc {
  const target = new Y.Doc();
  const sourceIndex = new WorkbookIndex(source);
  const usedStyles = new Set<string>();
  const pairs: SheetPair[] = [];

  target.transact(() => {
    const meta = target.getMap(META_MAP);
    source.getMap(META_MAP).forEach((value, key) => {
      if (key !== REPLACED_BY_FIELD) {
        meta.set(key, plain(value));
      }
    });

    for (const { id, sheet } of readSheets(source)) {
      const copy = newSheetMap(readSheetName(sheet));
      sheet.forEach((value, key) => {
        if (!STRUCTURAL_KEYS.has(key)) {
          copy.set(key, plain(value));
        }
      });
      sheetsMap(target).set(id, copy);
      sheetOrderArray(target).push([id]);
      const rows = readAxis(sheet, 'rows');
      const columns = readAxis(sheet, 'columns');
      insertLineIds(copy, 'rows', rows.ids);
      insertLineIds(copy, 'columns', columns.ids);
      pairs.push({ id, source: sheet, target: copy, rows, columns });
    }
  });

  const targetIndex = new WorkbookIndex(target);
  const restate = (formula: string, scope: Omit<FormulaScope, 'workbook'>) =>
    codec.store(codec.display(formula, { ...scope, workbook: sourceIndex }), { ...scope, workbook: targetIndex });

  target.transact(() => {
    for (const pair of pairs) {
      copyLines(pair, 'columns', usedStyles);
      copyRows(pair, usedStyles, restate);
      copyMerges(pair);
      copyRules(pair, restate);
    }

    const firstSheet = pairs[0]?.id;
    namesMap(source).forEach((value, id) => {
      if (!isStoredName(value)) {
        return;
      }
      const scopeSheet = value.sheetId ?? firstSheet;
      if (value.sheetId !== undefined && !pairs.some((pair) => pair.id === value.sheetId)) {
        return;
      }
      namesMap(target).set(id, {
        ...value,
        formula: scopeSheet === undefined ? value.formula : restate(value.formula, { sheetId: scopeSheet, row: 0, column: 0 }),
      });
    });

    const styles = stylesMap(source);
    for (const styleId of usedStyles) {
      const style = styles.get(styleId);
      if (style !== undefined) {
        stylesMap(target).set(styleId, plain(style));
      }
    }
  });

  return target;
}

function copyLines(pair: SheetPair, dimension: Dimension, usedStyles: Set<string>): void {
  const from = linesMap(pair.source, dimension);
  const to = linesMap(pair.target, dimension);
  for (const id of (dimension === 'rows' ? pair.rows : pair.columns).ids) {
    const line = from.get(id);
    const copy = to.get(id);
    if (line === undefined || copy === undefined) {
      continue;
    }
    line.forEach((value, key) => {
      if (key.startsWith(LINE_PROPERTY_PREFIX) || key === LINE_STYLE) {
        copy.set(key, plain(value));
        if (key === LINE_STYLE && typeof value === 'string') {
          usedStyles.add(value);
        }
      }
    });
  }
}

function copyRows(
  pair: SheetPair,
  usedStyles: Set<string>,
  restate: (formula: string, scope: Omit<FormulaScope, 'workbook'>) => string,
): void {
  copyLines(pair, 'rows', usedStyles);
  const from = linesMap(pair.source, 'rows');
  const to = linesMap(pair.target, 'rows');
  pair.rows.ids.forEach((rowId, row) => {
    const line = from.get(rowId);
    const copy = to.get(rowId);
    if (line === undefined || copy === undefined) {
      return;
    }
    line.forEach((value, key) => {
      if (key.startsWith(STYLE_KEY_PREFIX) && key !== LINE_STYLE) {
        if (pair.columns.indexOf(key.slice(STYLE_KEY_PREFIX.length)) !== undefined && typeof value === 'string') {
          copy.set(key, value);
          usedStyles.add(value);
        }
        return;
      }
      if (!isCellKey(key)) {
        return;
      }
      const column = pair.columns.indexOf(key);
      if (column === undefined) {
        return;
      }
      const content = plain(value);
      copy.set(
        key,
        isFormulaContent(content) ? { ...content, f: restate(content.f, { sheetId: pair.id, row, column }) } : content,
      );
    });
  });
}

function reanchor(range: unknown, pair: SheetPair): IdRange | undefined {
  if (!isIdRange(range)) {
    return undefined;
  }
  const resolved = resolveRange(range, pair.rows, pair.columns);
  return resolved === undefined ? undefined : anchorRange(toGridRange(resolved), pair.rows, pair.columns);
}

function copyMerges(pair: SheetPair): void {
  const merges = mergesMap(pair.target);
  for (const { id, range } of readMerges(pair.source)) {
    const anchored = anchorRange(toGridRange(range), pair.rows, pair.columns);
    if (anchored !== undefined) {
      merges.set(id, anchored);
    }
  }
}

function copyRules(pair: SheetPair, restate: (formula: string, scope: Omit<FormulaScope, 'workbook'>) => string): void {
  const rules = rulesMap(pair.target);
  rulesMap(pair.source).forEach((value, id) => {
    const stored = plain(value) as { feature?: unknown; ranges?: unknown; body?: unknown; order?: unknown } | undefined;
    if (stored === undefined || typeof stored.feature !== 'string' || !Array.isArray(stored.ranges)) {
      return;
    }
    const resolved = stored.ranges
      .map((range) => (isIdRange(range) ? resolveRange(range, pair.rows, pair.columns) : undefined))
      .filter((range) => range !== undefined);
    const ranges = stored.ranges.map((range) => reanchor(range, pair)).filter((range): range is IdRange => range !== undefined);
    if (ranges.length === 0) {
      return;
    }
    const first = resolved[0];
    const scope = {
      sheetId: pair.id,
      row: first === undefined || first.wholeColumns ? 0 : first.startRow,
      column: first === undefined || first.wholeRows ? 0 : first.startColumn,
    };
    let body = stored.body;
    if (stored.feature === CHART_FEATURE) {
      body = rebuildChartBody(body, pair);
      if (body === undefined) {
        return;
      }
    } else if (FORMULA_FEATURES.has(stored.feature)) {
      body = mapRuleFormulas(stored.feature as typeof VALIDATION_FEATURE, body, (formula) => restate(formula, scope));
    } else if (stored.feature === FILTER_FEATURE) {
      body = rebuildFilterBody(body, pair);
    }
    rules.set(id, { ...stored, ranges, body });
  });
}

function rebuildChartBody(body: unknown, pair: SheetPair): unknown {
  const record = (typeof body === 'object' && body !== null ? body : {}) as { anchor?: StoredAnchor };
  if (record.anchor === undefined) {
    return body;
  }
  const resolved = resolveAnchor(record.anchor, pair.rows, pair.columns);
  const anchor = resolved === undefined ? undefined : anchorChart(resolved, pair.rows, pair.columns);
  return anchor === undefined ? undefined : { ...record, anchor };
}

function rebuildFilterBody(body: unknown, pair: SheetPair): unknown {
  const record = (typeof body === 'object' && body !== null ? body : {}) as { columns?: { column?: unknown }[] };
  if (!Array.isArray(record.columns)) {
    return body;
  }
  return {
    ...record,
    columns: record.columns.filter((entry) => typeof entry.column === 'string' && pair.columns.indexOf(entry.column) !== undefined),
  };
}
