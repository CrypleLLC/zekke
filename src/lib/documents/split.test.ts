import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { UnsplittableUpdateError, splitUpdate } from './split';

function captureUpdate(doc: Y.Doc, change: () => void): Uint8Array {
  let captured: Uint8Array | undefined;
  const handler = (update: Uint8Array) => {
    captured = update;
  };
  doc.on('update', handler);
  doc.transact(change);
  doc.off('update', handler);
  return captured!;
}

function replica(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
}

function state(doc: Y.Doc): unknown {
  return {
    list: doc.getArray('list').toJSON(),
    map: doc.getMap('map').toJSON(),
    text: doc.getText('text').toString(),
  };
}

function expectSplitApplies(base: Y.Doc, update: Uint8Array, maxBytes: number, order: 'forward' | 'reverse' = 'forward'): Uint8Array[] {
  const expected = replica(base);
  Y.applyUpdate(expected, update);
  const chunks = splitUpdate(update, maxBytes);
  for (const chunk of chunks) {
    expect(chunk.length).toBeLessThanOrEqual(maxBytes);
  }
  const target = replica(base);
  for (const chunk of order === 'forward' ? chunks : [...chunks].reverse()) {
    Y.applyUpdate(target, chunk);
  }
  expect(state(target)).toEqual(state(expected));
  expect(Y.encodeStateVector(target)).toEqual(Y.encodeStateVector(expected));
  return chunks;
}

describe('splitting a Yjs update', () => {
  it('returns an update under the ceiling as it is', () => {
    const doc = new Y.Doc();
    const update = captureUpdate(doc, () => doc.getMap('map').set('a', 1));
    expect(splitUpdate(update, 1000)).toEqual([update]);
  });

  it('splits many small structs, and the pieces rebuild the same document in either order', () => {
    const base = new Y.Doc();
    base.getMap('map').set('seed', true);
    const doc = replica(base);
    const update = captureUpdate(doc, () => {
      for (let index = 0; index < 5000; index += 1) {
        doc.getMap('map').set(`key${index}`, { v: index * 1.5, label: `value ${index}` });
      }
    });
    expect(expectSplitApplies(base, update, 20_000).length).toBeGreaterThan(5);
    expectSplitApplies(base, update, 20_000, 'reverse');
  });

  it('splits one large array insertion, which Yjs keeps as a single struct', () => {
    const base = new Y.Doc();
    base.getArray('list').push(['first', 'last']);
    const doc = replica(base);
    const update = captureUpdate(doc, () => {
      doc.getArray('list').insert(1, Array.from({ length: 30_000 }, (_, index) => `id${index}`));
    });
    expect(Y.decodeUpdate(update).structs.length).toBeLessThan(5);
    expect(expectSplitApplies(base, update, 16_000).length).toBeGreaterThan(5);
  });

  it('splits one long text insertion without breaking a surrogate pair', () => {
    const base = new Y.Doc();
    const doc = replica(base);
    const update = captureUpdate(doc, () => doc.getText('text').insert(0, '😀a'.repeat(20_000)));
    expectSplitApplies(base, update, 8_000);
  });

  it('carries deletions, including a delete set too large for one piece', () => {
    const base = new Y.Doc();
    const list = base.getArray<number>('list');
    for (let index = 0; index < 4000; index += 1) {
      list.push([index]);
    }
    const doc = replica(base);
    const update = captureUpdate(doc, () => {
      const target = doc.getArray<number>('list');
      for (let index = target.length - 2; index >= 0; index -= 2) {
        target.delete(index, 1);
      }
      doc.getMap('map').set('after', 'deletes');
    });
    expectSplitApplies(base, update, 4_000);
  });

  it('carries changes from several clients, as a merged update holds', () => {
    const base = new Y.Doc();
    const first = replica(base);
    const second = replica(base);
    const a = captureUpdate(first, () => first.getArray('list').insert(0, Array.from({ length: 3000 }, (_, index) => index)));
    const b = captureUpdate(second, () => second.getText('text').insert(0, 'x'.repeat(10_000)));
    expectSplitApplies(base, Y.mergeUpdates([a, b]), 6_000);
  });

  it('refuses a struct that no split can bring under the ceiling', () => {
    const doc = new Y.Doc();
    const update = captureUpdate(doc, () => doc.getMap('map').set('cell', { text: 'x'.repeat(50_000) }));
    expect(() => splitUpdate(update, 10_000)).toThrow(UnsplittableUpdateError);
  });
});
