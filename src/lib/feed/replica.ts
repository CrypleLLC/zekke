import type { Change, ItemType } from './records';

interface Row {
  seq: number;
  item: Record<string, unknown>;
}

export class ScopeReplica {
  private rows = new Map<ItemType, Map<string, Row>>();
  private removed = new Map<string, number>();
  cursor = 0;
  synced = false;

  apply(changes: readonly Change[], cursor: number): boolean {
    let changed = false;
    for (const change of changes) {
      changed = this.applyOne(change) || changed;
    }
    this.cursor = Math.max(this.cursor, cursor);
    return changed;
  }

  reset(): void {
    this.rows = new Map();
    this.removed = new Map();
    this.cursor = 0;
    this.synced = false;
  }

  items<T>(type: ItemType): T[] {
    return [...(this.rows.get(type)?.values() ?? [])].map((row) => row.item as T);
  }

  size(): number {
    let count = 0;
    for (const rows of this.rows.values()) {
      count += rows.size;
    }
    return count;
  }

  private applyOne(change: Change): boolean {
    const key = `${change.type}:${change.id}`;
    const rows = this.rowsOf(change.type);
    const current = rows.get(change.id);
    const removedAt = this.removed.get(key) ?? 0;

    if (change.tombstone) {
      if (current !== undefined && current.seq >= change.seq) {
        return false;
      }
      this.removed.set(key, Math.max(removedAt, change.seq));
      return rows.delete(change.id);
    }

    if (change.item === undefined || removedAt >= change.seq) {
      return false;
    }
    if (current !== undefined && current.seq >= change.seq) {
      return false;
    }
    rows.set(change.id, { seq: change.seq, item: withoutNulls(change.item) });
    return true;
  }

  private rowsOf(type: ItemType): Map<string, Row> {
    let rows = this.rows.get(type);
    if (rows === undefined) {
      rows = new Map();
      this.rows.set(type, rows);
    }
    return rows;
  }
}

function withoutNulls(item: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (value !== null) {
      clean[key] = value;
    }
  }
  return clean;
}
