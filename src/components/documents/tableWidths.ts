import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { CellSelection, TableMap } from '@tiptap/pm/tables';

export interface TableAt {
  pos: number;
  node: PMNode;
}

type Located = Pick<EditorState, 'selection'>;

export function tableAt(state: Located): TableAt | undefined {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.spec.tableRole === 'table') {
      return { pos: $from.before(depth), node };
    }
  }
  return undefined;
}

export function currentColumn(state: Located): number | undefined {
  const table = tableAt(state);
  if (table === undefined) {
    return undefined;
  }
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const role = $from.node(depth).type.spec.tableRole;
    if (role === 'cell' || role === 'header_cell') {
      const offset = $from.before(depth) - table.pos - 1;
      return TableMap.get(table.node).findCell(offset).left;
    }
  }
  return undefined;
}

export function storedColumnWidths(table: PMNode): (number | undefined)[] {
  const map = TableMap.get(table);
  const widths: (number | undefined)[] = Array.from({ length: map.width }, () => undefined);

  for (let column = 0; column < map.width; column += 1) {
    for (let row = 0; row < map.height; row += 1) {
      const offset = map.map[row * map.width + column];
      const cell = table.nodeAt(offset);
      const rect = map.findCell(offset);
      const colwidth = cell?.attrs.colwidth as number[] | null | undefined;
      const width = colwidth?.[column - rect.left];
      if (typeof width === 'number' && width > 0) {
        widths[column] = width;
        break;
      }
    }
  }

  return widths;
}

export function measuredColumnWidths(view: EditorView, table: TableAt): number[] {
  const map = TableMap.get(table.node);
  const widths = Array.from({ length: map.width }, () => 0);
  const dom = view.nodeDOM(table.pos);
  const firstRow = dom instanceof HTMLElement ? dom.querySelector('tr') : null;
  if (firstRow === null) {
    return widths;
  }

  let column = 0;
  for (const cell of Array.from(firstRow.children)) {
    if (!(cell instanceof HTMLElement)) {
      continue;
    }
    const span = Math.max(1, Number(cell.getAttribute('colspan')) || 1);
    for (let index = 0; index < span && column < widths.length; index += 1) {
      widths[column] = cell.offsetWidth / span;
      column += 1;
    }
  }

  return widths;
}

export function columnWidths(view: EditorView, table: TableAt): number[] {
  const stored = storedColumnWidths(table.node);
  const measured = measuredColumnWidths(view, table);
  return stored.map((width, index) => Math.round(width ?? measured[index] ?? 0));
}

export function withColumnWidths(
  tr: Transaction,
  table: TableAt,
  widths: readonly (number | null)[],
): Transaction {
  const map = TableMap.get(table.node);
  const seen = new Set<number>();

  for (const offset of map.map) {
    if (seen.has(offset)) {
      continue;
    }
    seen.add(offset);
    const cell = table.node.nodeAt(offset);
    if (cell === null) {
      continue;
    }
    const rect = map.findCell(offset);
    const slice = widths.slice(rect.left, rect.right);
    const colwidth = slice.every((width): width is number => typeof width === 'number')
      ? slice
      : null;
    tr.setNodeMarkup(table.pos + 1 + offset, undefined, { ...cell.attrs, colwidth });
  }

  return tr;
}

export function cellAt(doc: EditorState['doc'], pos: number): number | undefined {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const role = $pos.node(depth).type.spec.tableRole;
    if (role === 'cell' || role === 'header_cell') {
      return $pos.before(depth);
    }
  }
  return undefined;
}

export function focusCell(tr: Transaction, cellPos: number): boolean {
  const selection = tr.selection;
  if (selection instanceof CellSelection) {
    let inside = false;
    selection.forEachCell((_cell, pos) => {
      inside ||= pos === cellPos;
    });
    if (inside) {
      return false;
    }
  } else if (cellAt(tr.doc, selection.from) === cellPos) {
    return false;
  }
  tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos + 1)));
  return true;
}
