import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  documentPageCount,
  isPaginated,
  markPaginated,
  markRemeasure,
  paginationRevision,
  paginationKey,
  paginationPlugin,
} from './pagination';
import { PAGE_BREAK_NAME, PageBreak } from './pageBreak';

const schema = getSchema([StarterKit, PageBreak]);

function stateWith(paginated: boolean): EditorState {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('one')]),
    schema.node(PAGE_BREAK_NAME),
    schema.node('paragraph', null, [schema.text('two')]),
  ]);
  return EditorState.create({ schema, doc, plugins: [paginationPlugin(paginated)] });
}

function measured(state: EditorState, pages: number): EditorState {
  const decorations = DecorationSet.create(state.doc, [
    Decoration.widget(5, () => ({}) as HTMLElement, { side: -1 }),
  ]);
  return state.apply(
    state.tr.setMeta(paginationKey, { pages, starts: [{ index: 1, fill: 0 }], decorations }),
  );
}

describe('pagination on and off', () => {
  it('starts in the mode the editor was created with', () => {
    expect(isPaginated(stateWith(true))).toBe(true);
    expect(isPaginated(stateWith(false))).toBe(false);
  });

  it('drops the page gaps and the page count when turned off', () => {
    const paged = measured(stateWith(true), 2);
    expect(documentPageCount(paged)).toBe(2);
    expect(paginationKey.getState(paged)?.decorations.find()).toHaveLength(1);

    const continuous = paged.apply(markPaginated(paged.tr, false));
    expect(isPaginated(continuous)).toBe(false);
    expect(documentPageCount(continuous)).toBe(1);
    expect(paginationKey.getState(continuous)?.decorations.find()).toHaveLength(0);
  });

  it('ignores a measurement that lands while turned off', () => {
    const continuous = measured(stateWith(false), 3);
    expect(documentPageCount(continuous)).toBe(1);
    expect(paginationKey.getState(continuous)?.decorations.find()).toHaveLength(0);
  });

  it('keeps the page breaks in the document either way', () => {
    const paged = stateWith(true);
    const continuous = paged.apply(markPaginated(paged.tr, false));
    const back = continuous.apply(markPaginated(continuous.tr, true));
    expect(continuous.doc.child(1).type.name).toBe(PAGE_BREAK_NAME);
    expect(continuous.doc.eq(paged.doc)).toBe(true);
    expect(back.doc.eq(paged.doc)).toBe(true);
    expect(isPaginated(back)).toBe(true);
  });

  it('is not an undoable edit', () => {
    const state = stateWith(true);
    expect(markPaginated(state.tr, false).getMeta('addToHistory')).toBe(false);
  });
});

describe('remeasuring after the page geometry changes', () => {
  it('bumps a revision the measuring view watches, and keeps what was measured until then', () => {
    const paged = measured(stateWith(true), 2);
    const bumped = paged.apply(markRemeasure(paged.tr));
    expect(paginationRevision(bumped)).toBe(paginationRevision(paged) + 1);
    expect(documentPageCount(bumped)).toBe(2);
    expect(markRemeasure(paged.tr).getMeta('addToHistory')).toBe(false);
  });

  it('carries the revision through a measurement and a mode switch', () => {
    const bumped = stateWith(true).apply(markRemeasure(stateWith(true).tr));
    const remeasured = measured(bumped, 3);
    expect(paginationRevision(remeasured)).toBe(1);
    const continuous = remeasured.apply(markPaginated(remeasured.tr, false));
    expect(paginationRevision(continuous)).toBe(1);
  });
});
