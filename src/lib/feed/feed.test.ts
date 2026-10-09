import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { Feed, type ChangesFetcher } from './feed';
import type { Change, ChangesPage, FeedScope } from './records';
import { ScopeReplica } from './replica';
import {
  currentCredentialsOf,
  deletedSecretsOf,
  documentMetasOf,
  filesOf,
  notesOf,
  secretsOf,
  treeFoldersOf,
} from './views';

const at = (minute: number) => `2026-10-08T12:${String(minute).padStart(2, '0')}:00.000000Z`;

function note(seq: number, id: string, minute: number, extra: Record<string, unknown> = {}): Change {
  return {
    seq,
    type: 'note',
    id,
    tombstone: false,
    item: { id, ciphertext: `c${seq}`, wrapped_dek: 'w', key_generation: 1, version: 'v1', created_at: at(minute), updated_at: at(minute), ...extra },
  };
}

function tombstone(seq: number, type: Change['type'], id: string): Change {
  return { seq, type, id, tombstone: true };
}

class FakeServer {
  log: Change[] = [];
  prunedThrough = 0;
  calls: number[] = [];

  head(): number {
    return this.log.reduce((highest, change) => Math.max(highest, change.seq), 0);
  }

  fetcher(pageSize = 100): ChangesFetcher {
    return async (_scope: FeedScope, since: number, limit: number): Promise<ChangesPage> => {
      this.calls.push(since);
      if (since > this.head() || (since > 0 && since < this.prunedThrough)) {
        throw new ApiError({ code: 'RESET', status: 410, endpoint: 'GET /changes' });
      }
      const newest = new Map<string, Change>();
      for (const change of this.log.filter((entry) => entry.seq > since)) {
        if (since === 0 && change.tombstone) {
          continue;
        }
        newest.set(`${change.type}:${change.id}`, change);
      }
      const ordered = [...newest.values()].sort((left, right) => left.seq - right.seq);
      const size = Math.min(limit, pageSize);
      const page = ordered.slice(0, size);
      const more = ordered.length > size;
      return { changes: page, cursor: more ? page[page.length - 1].seq : this.head(), more };
    };
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ScopeReplica', () => {
  it('keeps the newest version of each row and drops a tombstoned one', () => {
    const replica = new ScopeReplica();
    replica.apply([note(1, 'a', 1), note(2, 'b', 2)], 2);
    replica.apply([note(3, 'a', 1, { ciphertext: 'edited' }), tombstone(4, 'note', 'b')], 4);

    expect(replica.items<{ id: string; ciphertext: string }>('note')).toEqual([
      expect.objectContaining({ id: 'a', ciphertext: 'edited' }),
    ]);
    expect(replica.cursor).toBe(4);
  });

  it('ignores an older copy, including its own write coming back late', () => {
    const replica = new ScopeReplica();
    replica.apply([note(5, 'a', 1, { ciphertext: 'new' })], 5);

    expect(replica.apply([note(3, 'a', 1, { ciphertext: 'old' })], 5)).toBe(false);
    expect(replica.items<{ ciphertext: string }>('note')[0].ciphertext).toBe('new');
  });

  it('does not resurrect a row from a copy older than its tombstone', () => {
    const replica = new ScopeReplica();
    replica.apply([tombstone(6, 'note', 'a')], 6);

    expect(replica.apply([note(4, 'a', 1)], 6)).toBe(false);
    expect(replica.size()).toBe(0);
  });

  it('turns null fields into absent ones, as the item endpoints serve them', () => {
    const replica = new ScopeReplica();
    replica.apply([{ seq: 1, type: 'file', id: 'f', tombstone: false, item: { id: 'f', folder_id: null, deleted_at: null } }], 1);

    expect(replica.items<Record<string, unknown>>('file')[0]).toEqual({ id: 'f' });
  });
});

describe('Feed', () => {
  it('pulls from zero, then only what changed', async () => {
    const server = new FakeServer();
    server.log.push(note(1, 'a', 1), note(2, 'b', 2));
    const feed = new Feed(server.fetcher());

    expect(await feed.sync('notes')).toBe(true);
    expect(await feed.sync('notes')).toBe(false);

    server.log.push(note(3, 'c', 3));
    expect(await feed.sync('notes')).toBe(true);

    expect(server.calls).toEqual([0, 2, 2]);
    expect(notesOf(feed.replica('notes')).map((entry) => entry.id)).toEqual(['c', 'b', 'a']);
  });

  it('follows every page in one sync', async () => {
    const server = new FakeServer();
    for (let seq = 1; seq <= 5; seq++) {
      server.log.push(note(seq, `n${seq}`, seq));
    }
    const feed = new Feed(server.fetcher(2));

    await feed.sync('notes');

    expect(server.calls).toEqual([0, 2, 4]);
    expect(feed.replica('notes').size()).toBe(5);
  });

  it('starts over from zero when the cursor is older than the kept tombstones', async () => {
    const server = new FakeServer();
    server.log.push(note(1, 'a', 1), note(2, 'b', 2));
    const feed = new Feed(server.fetcher());
    await feed.sync('notes');

    server.log = [note(1, 'a', 1), note(5, 'c', 5)];
    server.prunedThrough = 4;

    expect(await feed.sync('notes')).toBe(true);
    expect(server.calls).toEqual([0, 2, 0]);
    expect(notesOf(feed.replica('notes')).map((entry) => entry.id)).toEqual(['c', 'a']);
  });

  it('runs one request at a time per scope, and a call that arrives meanwhile gets a fresh pull', async () => {
    const server = new FakeServer();
    server.log.push(note(1, 'a', 1));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = server.fetcher();
    const feed = new Feed(async (scope, since, limit) => {
      await gate;
      return fetch(scope, since, limit);
    });

    const first = feed.sync('notes');
    const second = feed.sync('notes');
    const third = feed.sync('notes');
    server.log.push(note(2, 'b', 2));
    release();
    await Promise.all([first, second, third]);

    expect(server.calls.length).toBe(2);
    expect(feed.replica('notes').size()).toBe(2);
  });

  it('tells subscribers about a background change, but not about a screen’s own read', async () => {
    const server = new FakeServer();
    server.log.push(note(1, 'a', 1));
    const feed = new Feed(server.fetcher());
    const heard = vi.fn();
    feed.subscribe('notes', heard);

    await feed.sync('notes', { notify: false });
    expect(heard).not.toHaveBeenCalled();

    server.log.push(note(2, 'b', 2));
    await feed.sync('notes');
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('polls every held scope, backing off while nothing changes', async () => {
    vi.useFakeTimers();
    const server = new FakeServer();
    const feed = new Feed(server.fetcher(), { pollIntervalMs: 30_000, maxPollIntervalMs: 120_000 });
    await feed.syncAll(['notes', 'secrets']);
    server.calls = [];

    feed.startPolling(['notes', 'secrets']);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(server.calls).toEqual([0, 0]);
    expect(feed.currentPollDelay()).toBe(60_000);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(feed.currentPollDelay()).toBe(120_000);

    server.log.push(note(1, 'a', 1));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(feed.currentPollDelay()).toBe(30_000);

    feed.stopPolling();
    const before = server.calls.length;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(server.calls.length).toBe(before);
  });
});

describe('views', () => {
  it('splits live and recently deleted secrets, each in its server order', () => {
    const replica = new ScopeReplica();
    replica.apply(
      [
        { seq: 1, type: 'secret', id: 's1', tombstone: false, item: { id: 's1', created_at: at(1), deleted_at: null } },
        { seq: 2, type: 'secret', id: 's2', tombstone: false, item: { id: 's2', created_at: at(2), deleted_at: null } },
        { seq: 3, type: 'secret', id: 's3', tombstone: false, item: { id: 's3', created_at: at(3), deleted_at: at(9) } },
        { seq: 4, type: 'folder_manifest', id: 'secrets', tombstone: false, item: { scope: 'secrets' } },
      ],
      4,
    );

    expect(secretsOf(replica).map((row) => row.id)).toEqual(['s2', 's1']);
    expect(secretsOf(replica)[0]).not.toHaveProperty('deleted_at');
    expect(deletedSecretsOf(replica).map((row) => row.id)).toEqual(['s3']);
  });

  it('serves each credential’s newest revision, and none for a deleted one', () => {
    const replica = new ScopeReplica();
    const revision = (seq: number, credential: string, deleted = false): Change => ({
      seq,
      type: 'credential',
      id: `r${seq}`,
      tombstone: false,
      item: { credential_id: credential, revision_id: `r${seq}`, seq, ciphertext: deleted ? '' : 'c', deleted },
    });
    replica.apply([revision(1, 'x'), revision(2, 'y'), revision(3, 'x'), revision(4, 'y', true)], 4);

    const current = currentCredentialsOf(replica);
    expect(current.map((row) => row.revision_id)).toEqual(['r3']);
    expect(current[0]).not.toHaveProperty('deleted');
  });

  it('filters files and documents by folder and leaves the Trash out', () => {
    const replica = new ScopeReplica();
    const file = (seq: number, folder: string | null, deleted: string | null = null): Change => ({
      seq,
      type: 'file',
      id: `f${seq}`,
      tombstone: false,
      item: { id: `f${seq}`, created_at: at(seq), folder_id: folder, deleted_at: deleted, r2_state: 'pending' },
    });
    replica.apply([file(1, null), file(2, 'folder'), file(3, null, at(30))], 3);

    expect(filesOf(replica).map((row) => row.id)).toEqual(['f2', 'f1']);
    expect(filesOf(replica, 'root').map((row) => row.id)).toEqual(['f1']);
    expect(filesOf(replica, 'folder').map((row) => row.id)).toEqual(['f2']);

    const documents = new ScopeReplica();
    documents.apply(
      [{ seq: 1, type: 'document', id: 'd1', tombstone: false, item: { id: 'd1', created_at: at(1), folder_id: 'folder' } }],
      1,
    );
    expect(documentMetasOf(documents, 'root')).toEqual([]);
    expect(documentMetasOf(documents, 'folder').map((row) => row.id)).toEqual(['d1']);
  });

  it('orders a folder tree as the tree route does', () => {
    const replica = new ScopeReplica();
    const folder = (seq: number, id: string, parent: string | null, position: number): Change => ({
      seq,
      type: 'file_folder',
      id,
      tombstone: false,
      item: { id, parent_id: parent, position, created_at: at(seq), deleted_at: null },
    });
    replica.apply([folder(1, 'child', 'top', 0), folder(2, 'b', null, 1), folder(3, 'top', null, 0)], 3);

    expect(treeFoldersOf(replica, 'file_folder').map((row) => row.id)).toEqual(['top', 'b', 'child']);
    expect(treeFoldersOf(replica, 'document_folder')).toEqual([]);
  });
});
