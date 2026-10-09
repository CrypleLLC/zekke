import { afterEach, describe, expect, it, vi } from 'vitest';
import { listUpdatesSince, type DocumentsContext } from './api';
import { RevisionChangedError, SequenceGapError } from './records';

const DOCUMENT_ID = '3f6b0d3e-8f2a-4d1c-9a5e-2b7c1d4e6f80';
const context = { tokens: { get: () => 'token' } } as unknown as DocumentsContext;

afterEach(() => vi.unstubAllGlobals());

function serve(pages: unknown[]): string[] {
  const urls: string[] = [];
  let next = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      const body = pages[next++];
      return {
        status: 200,
        ok: true,
        text: async () => JSON.stringify(body),
        headers: { get: () => null },
      } as unknown as Response;
    }),
  );
  return urls;
}

function update(seq: number) {
  return { seq, ciphertext: 'c2VhbGVk', created_at: '2026-10-08T00:00:00Z' };
}

describe('listUpdatesSince', () => {
  it('returns the document’s revision and snapshot with the updates', async () => {
    serve([{ data: [update(5), update(6)], page: { has_more: false }, document: { revision: 3, snapshot_seq: 4 } }]);

    const listed = await listUpdatesSince(context, DOCUMENT_ID, 4);

    expect(listed.revision).toBe(3);
    expect(listed.snapshotSeq).toBe(4);
    expect(listed.updates.map((entry) => entry.seq)).toEqual([5, 6]);
  });

  it('follows every page and refuses one whose revision moved', async () => {
    const urls = serve([
      { data: [update(1)], page: { has_more: true, next_cursor: 'b2Zmc2V0OjE=' }, document: { revision: 3, snapshot_seq: 0 } },
      { data: [update(2)], page: { has_more: false }, document: { revision: 4, snapshot_seq: 2 } },
    ]);

    await expect(listUpdatesSince(context, DOCUMENT_ID, 0)).rejects.toBeInstanceOf(RevisionChangedError);
    expect(urls).toHaveLength(2);
  });

  it('still refuses a hole inside what it read', async () => {
    serve([{ data: [update(1), update(3)], page: { has_more: false }, document: { revision: 1, snapshot_seq: 0 } }]);

    await expect(listUpdatesSince(context, DOCUMENT_ID, 0)).rejects.toBeInstanceOf(SequenceGapError);
  });

  it('refuses a response that does not say which revision it read', async () => {
    serve([{ data: [], page: { has_more: false } }]);

    await expect(listUpdatesSince(context, DOCUMENT_ID, 0)).rejects.toThrow('no document revision');
  });
});
