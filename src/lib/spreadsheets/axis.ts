import * as Y from 'yjs';
import { COLUMN_ID_LENGTH, ROW_ID_LENGTH, freshIds } from './ids';
import {
  isCellKey,
  linesMap,
  orderArray,
  removedMap,
  styleKey,
  type Dimension,
  type LineMap,
  type SheetMap,
} from './layout';

export class Axis {
  readonly ids: readonly string[];
  private readonly liveIndex: Map<string, number>;
  private readonly slot: Map<string, number>;

  constructor(sequence: readonly string[], removed: ReadonlySet<string> | { has(id: string): boolean }) {
    const ids: string[] = [];
    const liveIndex = new Map<string, number>();
    const slot = new Map<string, number>();

    sequence.forEach((id) => {
      if (slot.has(id)) {
        return;
      }
      slot.set(id, ids.length);
      if (removed.has(id)) {
        return;
      }
      liveIndex.set(id, ids.length);
      ids.push(id);
    });

    this.ids = ids;
    this.liveIndex = liveIndex;
    this.slot = slot;
  }

  get size(): number {
    return this.ids.length;
  }

  idAt(index: number): string | undefined {
    return this.ids[index];
  }

  indexOf(id: string): number | undefined {
    return this.liveIndex.get(id);
  }

  knows(id: string): boolean {
    return this.slot.has(id);
  }

  allIds(): ReadonlySet<string> {
    return new Set(this.slot.keys());
  }

  startIndexOf(id: string): number | undefined {
    const live = this.liveIndex.get(id);
    if (live !== undefined) {
      return live;
    }
    const slot = this.slot.get(id);
    if (slot === undefined || slot >= this.ids.length) {
      return undefined;
    }
    return slot;
  }

  endIndexOf(id: string): number | undefined {
    const live = this.liveIndex.get(id);
    if (live !== undefined) {
      return live;
    }
    const slot = this.slot.get(id);
    if (slot === undefined || slot === 0) {
      return undefined;
    }
    return slot - 1;
  }
}

export function readAxis(sheet: SheetMap, dimension: Dimension): Axis {
  return new Axis(orderArray(sheet, dimension).toArray(), removedMap(sheet, dimension));
}

function idLength(dimension: Dimension): number {
  return dimension === 'rows' ? ROW_ID_LENGTH : COLUMN_ID_LENGTH;
}

function transact(sheet: SheetMap, change: () => void, origin?: unknown): void {
  const doc = sheet.doc;
  if (doc === null) {
    change();
    return;
  }
  doc.transact(change, origin);
}

function sequencePosition(order: Y.Array<string>, id: string | undefined): number {
  if (id === undefined) {
    return order.length;
  }
  const position = order.toArray().indexOf(id);
  return position === -1 ? order.length : position;
}

export function insertLineIds(
  sheet: SheetMap,
  dimension: Dimension,
  ids: readonly string[],
  beforeId?: string,
  origin?: unknown,
): void {
  if (ids.length === 0) {
    return;
  }
  transact(
    sheet,
    () => {
      const order = orderArray(sheet, dimension);
      const lines = linesMap(sheet, dimension);
      const removed = removedMap(sheet, dimension);
      order.insert(sequencePosition(order, beforeId), [...ids]);
      for (const id of ids) {
        if (removed.has(id)) {
          removed.delete(id);
        }
        lines.set(id, new Y.Map<unknown>());
      }
    },
    origin,
  );
}

export function removeLineIds(sheet: SheetMap, dimension: Dimension, ids: readonly string[], origin?: unknown): void {
  if (ids.length === 0) {
    return;
  }
  transact(
    sheet,
    () => {
      const removed = removedMap(sheet, dimension);
      const lines = linesMap(sheet, dimension);
      for (const id of ids) {
        removed.set(id, true);
        lines.delete(id);
      }
      if (dimension === 'columns') {
        clearColumnsFromRows(sheet, ids);
      }
    },
    origin,
  );
}

export function moveLineIds(
  sheet: SheetMap,
  dimension: Dimension,
  ids: readonly string[],
  beforeId?: string,
  origin?: unknown,
): void {
  if (ids.length === 0 || (beforeId !== undefined && ids.includes(beforeId))) {
    return;
  }
  transact(
    sheet,
    () => {
      const order = orderArray(sheet, dimension);
      const moving = new Set(ids);
      const sequence = order.toArray();
      for (let position = sequence.length - 1; position >= 0; position -= 1) {
        if (moving.has(sequence[position])) {
          order.delete(position, 1);
        }
      }
      order.insert(sequencePosition(order, beforeId), [...ids]);
    },
    origin,
  );
}

export function freshLineIds(sheet: SheetMap, dimension: Dimension, count: number, taken: Iterable<string> = []): string[] {
  const known = new Set(readAxis(sheet, dimension).allIds());
  for (const id of taken) {
    known.add(id);
  }
  return freshIds(count, idLength(dimension), known);
}

export function insertLines(
  sheet: SheetMap,
  dimension: Dimension,
  index: number,
  count: number,
  origin?: unknown,
): string[] {
  if (count <= 0) {
    return [];
  }
  const axis = readAxis(sheet, dimension);
  const ids = freshLineIds(sheet, dimension, count);
  insertLineIds(sheet, dimension, ids, axis.idAt(Math.max(0, index)), origin);
  return ids;
}

export function appendLines(sheet: SheetMap, dimension: Dimension, count: number, origin?: unknown): string[] {
  return insertLines(sheet, dimension, readAxis(sheet, dimension).size, count, origin);
}

export function removeLines(
  sheet: SheetMap,
  dimension: Dimension,
  index: number,
  count: number,
  origin?: unknown,
): string[] {
  const axis = readAxis(sheet, dimension);
  const ids = axis.ids.slice(Math.max(0, index), Math.max(0, index) + Math.max(0, count));
  removeLineIds(sheet, dimension, ids, origin);
  return ids;
}

function clearColumnsFromRows(sheet: SheetMap, columnIds: readonly string[]): void {
  linesMap(sheet, 'rows').forEach((row) => {
    for (const columnId of columnIds) {
      if (row.has(columnId)) {
        row.delete(columnId);
      }
      const key = styleKey(columnId);
      if (row.has(key)) {
        row.delete(key);
      }
    }
  });
}

export function restoreLines(sheet: SheetMap, dimension: Dimension, ids: readonly string[], origin?: unknown): void {
  transact(
    sheet,
    () => {
      const removed = removedMap(sheet, dimension);
      const lines = linesMap(sheet, dimension);
      for (const id of ids) {
        removed.delete(id);
        if (!lines.has(id)) {
          lines.set(id, new Y.Map<unknown>());
        }
      }
    },
    origin,
  );
}

export function moveLines(
  sheet: SheetMap,
  dimension: Dimension,
  index: number,
  count: number,
  toIndex: number,
  origin?: unknown,
): string[] {
  const axis = readAxis(sheet, dimension);
  const start = Math.max(0, index);
  const ids = axis.ids.slice(start, start + Math.max(0, count));
  if (ids.length === 0 || (toIndex >= start && toIndex <= start + ids.length)) {
    return [];
  }
  moveLineIds(sheet, dimension, ids, axis.idAt(toIndex), origin);
  return ids;
}

export function line(sheet: SheetMap, dimension: Dimension, id: string): LineMap | undefined {
  return linesMap(sheet, dimension).get(id);
}

export function rowCellKeys(row: LineMap): string[] {
  return [...row.keys()].filter(isCellKey);
}
