import * as Y from 'yjs';
import {
  Axis,
  WorkbookIndex,
  freshIds,
  readAxis,
  readSheetName,
  readSheets,
  COLUMN_ID_LENGTH,
  ROW_ID_LENGTH,
  type Dimension,
} from '@/lib/spreadsheets';

export interface SheetMirror {
  name: string;
  rows: string[];
  columns: string[];
}

export class WorkbookMirror {
  readonly order: string[] = [];
  readonly sheets = new Map<string, SheetMirror>();

  static fromDoc(doc: Y.Doc): WorkbookMirror {
    const mirror = new WorkbookMirror();
    for (const { id, sheet } of readSheets(doc)) {
      mirror.order.push(id);
      mirror.sheets.set(id, {
        name: readSheetName(sheet),
        rows: [...readAxis(sheet, 'rows').ids],
        columns: [...readAxis(sheet, 'columns').ids],
      });
    }
    return mirror;
  }

  sheet(sheetId: string): SheetMirror | undefined {
    return this.sheets.get(sheetId);
  }

  index(): WorkbookIndex {
    return new WorkbookIndex(
      this.order.flatMap((id) => {
        const sheet = this.sheets.get(id);
        return sheet === undefined
          ? []
          : [{ id, name: sheet.name, rows: new Axis(sheet.rows, new Set()), columns: new Axis(sheet.columns, new Set()) }];
      }),
    );
  }

  freshLineIds(sheetId: string, dimension: Dimension, count: number, known: ReadonlySet<string>): string[] {
    const sheet = this.sheets.get(sheetId);
    const taken = new Set(known);
    for (const id of sheet?.[dimension] ?? []) {
      taken.add(id);
    }
    return freshIds(count, dimension === 'rows' ? ROW_ID_LENGTH : COLUMN_ID_LENGTH, taken);
  }
}

export type AxisStep = { action: 'remove'; index: number } | { action: 'insert'; index: number; id: string };

export function planAxis(current: readonly string[], target: readonly string[]): AxisStep[] {
  const steps: AxisStep[] = [];
  const working = [...current];
  const targetPosition = new Map(target.map((id, index) => [id, index]));

  for (let index = working.length - 1; index >= 0; index -= 1) {
    if (!targetPosition.has(working[index])) {
      steps.push({ action: 'remove', index });
      working.splice(index, 1);
    }
  }

  const kept = new Set(longestIncreasingRun(working.map((id) => targetPosition.get(id) as number)).map((index) => working[index]));
  for (let index = working.length - 1; index >= 0; index -= 1) {
    if (!kept.has(working[index])) {
      steps.push({ action: 'remove', index });
      working.splice(index, 1);
    }
  }

  for (let index = 0; index < target.length; index += 1) {
    if (working[index] !== target[index]) {
      steps.push({ action: 'insert', index, id: target[index] });
      working.splice(index, 0, target[index]);
    }
  }

  return steps;
}

function longestIncreasingRun(values: readonly number[]): number[] {
  const tails: number[] = [];
  const previous: number[] = new Array(values.length).fill(-1);
  for (let index = 0; index < values.length; index += 1) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]] < values[index]) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    if (low > 0) {
      previous[index] = tails[low - 1];
    }
    tails[low] = index;
  }
  const run: number[] = [];
  let cursor = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (cursor >= 0) {
    run.push(cursor);
    cursor = previous[cursor];
  }
  return run.reverse();
}

export type OrderStep = { id: string; from: number; to: number };

export function planOrder(current: readonly string[], target: readonly string[]): OrderStep[] {
  const working = current.filter((id) => target.includes(id));
  const steps: OrderStep[] = [];
  for (let index = 0; index < target.length; index += 1) {
    if (working[index] === target[index]) {
      continue;
    }
    const from = working.indexOf(target[index]);
    if (from === -1) {
      continue;
    }
    working.splice(from, 1);
    working.splice(index, 0, target[index]);
    steps.push({ id: target[index], from, to: index });
  }
  return steps;
}
