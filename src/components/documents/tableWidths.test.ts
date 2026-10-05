import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { ColouredTableCell, ColouredTableHeader } from './tableRows';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { CellSelection, setCellAttr } from '@tiptap/pm/tables';
import {
  cellAt,
  currentColumn,
  focusCell,
  storedColumnWidths,
  tableAt,
  withColumnWidths,
} from './tableWidths';
import { selectTable } from './tableHandle';

const schema = getSchema([
  StarterKit,
  TableKit.configure({ tableCell: false, tableHeader: false }),
  ColouredTableCell,
  ColouredTableHeader,
]);

function cell(text: string, attrs: Record<string, unknown> = {}): PMNode {
  return schema.node('tableCell', attrs, [schema.node('paragraph', null, text ? [schema.text(text)] : [])]);
}

function documentWith(rows: PMNode[][]): EditorState {
  const table = schema.node('table', null, rows.map((cells) => schema.node('tableRow', null, cells)));
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('before')]), table]);
  return EditorState.create({ schema, doc });
}

function caretIn(state: EditorState, text: string): EditorState {
  let at = -1;
  state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text === text) {
      at = pos + 1;
    }
  });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
}

describe('table widths in the document', () => {
  const grid = () =>
    documentWith([
      [cell('a1'), cell('b1'), cell('c1')],
      [cell('a2'), cell('b2'), cell('c2')],
    ]);

  it('finds the table and the column of the caret', () => {
    const state = caretIn(grid(), 'b2');
    expect(tableAt(state)?.node.type.name).toBe('table');
    expect(currentColumn(state)).toBe(1);
    expect(tableAt(caretIn(grid(), 'before'))).toBeUndefined();
    expect(currentColumn(caretIn(grid(), 'before'))).toBeUndefined();
  });

  it('writes a width into every cell of every column, and reads it back', () => {
    const state = caretIn(grid(), 'a1');
    const table = tableAt(state)!;
    const next = state.apply(withColumnWidths(state.tr, table, [100, 200, 300]));
    const written = tableAt(caretIn(next, 'a1'))!.node;

    expect(storedColumnWidths(written)).toEqual([100, 200, 300]);
    written.forEach((row) =>
      row.forEach((tableCell, _offset, index) =>
        expect(tableCell.attrs.colwidth).toEqual([[100], [200], [300]][index]),
      ),
    );
    expect(next.doc.textContent).toBe(state.doc.textContent);
  });

  it('gives a merged cell the widths of every column it spans', () => {
    const state = caretIn(
      documentWith([
        [cell('wide', { colspan: 2 }), cell('c1')],
        [cell('a2'), cell('b2'), cell('c2')],
      ]),
      'wide',
    );
    const next = state.apply(withColumnWidths(state.tr, tableAt(state)!, [100, 150, 200]));
    const written = tableAt(caretIn(next, 'wide'))!.node;

    expect(written.firstChild!.firstChild!.attrs.colwidth).toEqual([100, 150]);
    expect(storedColumnWidths(written)).toEqual([100, 150, 200]);
    expect(currentColumn(caretIn(next, 'c1'))).toBe(2);
  });

  it('clears the widths when any is unknown, which hands the table back to the text width', () => {
    const state = caretIn(grid(), 'a1');
    const sized = state.apply(withColumnWidths(state.tr, tableAt(state)!, [100, 200, 300]));
    const located = caretIn(sized, 'a1');
    const cleared = located.apply(withColumnWidths(located.tr, tableAt(located)!, [null, null, null]));

    expect(storedColumnWidths(tableAt(caretIn(cleared, 'a1'))!.node)).toEqual([undefined, undefined, undefined]);
  });
});

describe('selecting a table', () => {
  it('selects the whole table as one node, so copy, cut, delete and drag take all of it', () => {
    const state = caretIn(
      documentWith([[cell('a1'), cell('b1')]]),
      'b1',
    );
    const tr = state.tr;
    expect(selectTable(tr)).toBe(true);
    const selected = state.apply(tr);

    expect(selected.selection).toBeInstanceOf(NodeSelection);
    expect((selected.selection as NodeSelection).node.type.name).toBe('table');

    const removed = selected.apply(selected.tr.deleteSelection());
    expect(removed.doc.textContent).toBe('before');
  });

  it('does nothing outside a table', () => {
    const state = caretIn(documentWith([[cell('a1')]]), 'before');
    expect(selectTable(state.tr)).toBe(false);
  });
});

describe('the cell a context menu acts on', () => {
  const grid = () =>
    documentWith([
      [cell('a1'), cell('b1')],
      [cell('a2'), cell('b2')],
    ]);

  function cellPosOf(state: EditorState, text: string): number {
    const located = caretIn(state, text);
    return cellAt(located.doc, located.selection.from)!;
  }

  it('moves the caret into the cell that was right-clicked', () => {
    const state = caretIn(grid(), 'a1');
    const target = cellPosOf(state, 'b2');
    const tr = state.tr;

    expect(focusCell(tr, target)).toBe(true);
    const moved = state.apply(tr);
    expect(cellAt(moved.doc, moved.selection.from)).toBe(target);
    expect(currentColumn(moved)).toBe(1);
  });

  it('leaves the selection alone when the caret is already in that cell', () => {
    const state = caretIn(grid(), 'b2');
    expect(focusCell(state.tr, cellPosOf(state, 'b2'))).toBe(false);
  });

  it('keeps a selection of several cells that includes the clicked one, so a delete takes them all', () => {
    const state = grid();
    const first = cellPosOf(state, 'a1');
    const last = cellPosOf(state, 'a2');
    const selected = state.apply(state.tr.setSelection(CellSelection.create(state.doc, first, last)));

    expect(focusCell(selected.tr, last)).toBe(false);
    expect(focusCell(selected.tr, cellPosOf(state, 'b1'))).toBe(true);
  });

  it('finds no cell outside a table', () => {
    const state = caretIn(grid(), 'before');
    expect(cellAt(state.doc, state.selection.from)).toBeUndefined();
  });
});

describe('filling cells', () => {
  function fills(state: EditorState): (string | null)[] {
    const found: (string | null)[] = [];
    state.doc.descendants((node) => {
      if (node.type.spec.tableRole === 'cell') {
        found.push(node.attrs.backgroundColor as string | null);
      }
    });
    return found;
  }

  it('fills every selected cell and leaves the others', () => {
    const state = documentWith([
      [cell('a1'), cell('b1')],
      [cell('a2'), cell('b2')],
    ]);
    const positions: number[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type.spec.tableRole === 'cell') {
        positions.push(pos);
      }
    });
    const selected = state.apply(
      state.tr.setSelection(CellSelection.create(state.doc, positions[0], positions[2])),
    );

    let next = selected;
    setCellAttr('backgroundColor', '#fef08a')(selected, (tr) => {
      next = selected.apply(tr);
    });
    expect(fills(next)).toEqual(['#fef08a', null, '#fef08a', null]);
  });

  it('fills the cell holding the caret when no cells are selected', () => {
    const state = caretIn(documentWith([[cell('a1'), cell('b1')]]), 'b1');
    let next = state;
    setCellAttr('backgroundColor', '#bbf7d0')(state, (tr) => {
      next = state.apply(tr);
    });
    expect(fills(next)).toEqual([null, '#bbf7d0']);
  });
});
