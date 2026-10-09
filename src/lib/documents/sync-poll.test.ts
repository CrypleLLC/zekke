import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ApiError } from '@/lib/api';
import { FakeDocumentServer } from '@/test/document-server';
import { RevisionChangedError, type DocumentTransport } from './index';
import { DocumentSync, type DocumentSyncOptions } from './sync';

interface Counted {
  transport: DocumentTransport;
  calls: { fetchDocument: number; fetchUpdates: number; pushUpdates: number; compact: number };
}

function counted(server: FakeDocumentServer, overrides: Partial<DocumentTransport> = {}): Counted {
  const base = { ...server.transport(), ...overrides };
  const calls = { fetchDocument: 0, fetchUpdates: 0, pushUpdates: 0, compact: 0 };
  return {
    calls,
    transport: {
      ...base,
      fetchDocument: (id) => {
        calls.fetchDocument += 1;
        return base.fetchDocument(id);
      },
      fetchUpdates: (id, since) => {
        calls.fetchUpdates += 1;
        return base.fetchUpdates(id, since);
      },
      pushUpdates: (id, updates) => {
        calls.pushUpdates += 1;
        return base.pushUpdates(id, updates);
      },
      compact: (id, body) => {
        calls.compact += 1;
        return base.compact(id, body);
      },
    },
  };
}

async function open(
  server: FakeDocumentServer,
  transport: DocumentTransport = server.transport(),
  options: DocumentSyncOptions = {},
): Promise<DocumentSync> {
  const sync = new DocumentSync(server.id, transport, { debounceMs: 0, pollIntervalMs: 0, ...options });
  await sync.open();
  return sync;
}

function text(sync: DocumentSync): string {
  return sync.doc.getText('body').toString();
}

async function write(sync: DocumentSync, words: string): Promise<void> {
  sync.doc.getText('body').insert(text(sync).length, words);
  await sync.flush();
}

const notFound = () => new ApiError({ code: 'NOT_FOUND', status: 404, endpoint: 'GET /documents/doc/updates' });
const tooMany = (retryAfterSeconds?: number) =>
  new ApiError({ code: 'TOO_MANY_REQUESTS', status: 429, endpoint: 'POST /documents/doc/updates', retryAfterSeconds });

async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('polling one document', () => {
  it('an idle poll is one small request for this document and nothing else', async () => {
    const server = new FakeDocumentServer();
    const { transport, calls } = counted(server);
    const sync = await open(server, transport);
    const before = { ...calls };

    expect(await sync.poll()).toBe(false);

    expect(calls.fetchUpdates - before.fetchUpdates).toBe(1);
    expect(calls.fetchDocument - before.fetchDocument).toBe(0);
    sync.destroy();
  });

  it('applies another device’s edits from the same request', async () => {
    const server = new FakeDocumentServer();
    const reader = await open(server);
    const writer = await open(server);

    await write(writer, 'from elsewhere');

    expect(await reader.poll()).toBe(true);
    expect(text(reader)).toBe('from elsewhere');
    expect(await reader.poll()).toBe(false);
    reader.destroy();
    writer.destroy();
  });

  it('a compaction elsewhere that restarted the log is read from the new snapshot', async () => {
    const server = new FakeDocumentServer();
    const reader = await open(server);
    const writer = await open(server);
    for (const word of ['one ', 'two ', 'three ']) {
      await write(writer, word);
    }
    expect(await reader.poll()).toBe(true);

    await writer.compact();
    await write(writer, 'four');
    expect(server.latestSeq()).toBe(1);

    expect(await reader.poll()).toBe(true);
    expect(text(reader)).toBe('one two three four');
    expect(reader.getState().revision).toBe(server.revision);
    reader.destroy();
    writer.destroy();
  });

  it('a revision that changes between pages restarts from the snapshot', async () => {
    const server = new FakeDocumentServer();
    const writer = await open(server);
    await write(writer, 'kept');
    let raced = false;
    const { transport, calls } = counted(server, {
      fetchUpdates: async (id, since) => {
        if (!raced && since > 0) {
          raced = true;
          throw new RevisionChangedError(1, 2);
        }
        return server.transport().fetchUpdates(id, since);
      },
    });
    const reader = await open(server, transport);
    await write(writer, ' and more');
    const before = calls.fetchDocument;

    expect(await reader.poll()).toBe(true);

    expect(calls.fetchDocument - before).toBe(1);
    expect(text(reader)).toBe('kept and more');
    reader.destroy();
    writer.destroy();
  });

  it('a document deleted elsewhere says so and stops syncing', async () => {
    const server = new FakeDocumentServer();
    let deleted = false;
    const { transport, calls } = counted(server, {
      fetchUpdates: async (id, since) => {
        if (deleted) {
          throw notFound();
        }
        return server.transport().fetchUpdates(id, since);
      },
    });
    const sync = await open(server, transport);
    deleted = true;

    expect(await sync.poll()).toBe(false);
    expect(sync.getState().status).toBe('gone');

    sync.doc.getText('body').insert(0, 'lost');
    await sync.flush();
    expect(calls.pushUpdates).toBe(0);
    expect(await sync.poll()).toBe(false);
    sync.destroy();
  });

  it('backs off while nothing changes and returns to the base interval on a change', async () => {
    vi.useFakeTimers();
    const server = new FakeDocumentServer();
    const writer = await open(server);
    const reader = await open(server, server.transport(), { pollIntervalMs: 20_000, maxPollIntervalMs: 60_000 });

    reader.startPolling();
    expect(reader.currentPollDelay()).toBe(20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(reader.currentPollDelay()).toBe(40_000);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(reader.currentPollDelay()).toBe(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reader.currentPollDelay()).toBe(60_000);

    await write(writer, 'news');
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(text(reader)).toBe('news'));
    await vi.waitFor(() => expect(reader.currentPollDelay()).toBe(20_000));

    reader.stopPolling();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(reader.currentPollDelay()).toBe(20_000);
    reader.destroy();
    writer.destroy();
  });
});

describe('a refused write', () => {
  it('waits Retry-After, keeps the changes, and saves them on its own', async () => {
    vi.useFakeTimers();
    const server = new FakeDocumentServer();
    let refusals = 1;
    const { transport, calls } = counted(server, {
      pushUpdates: async (id, updates) => {
        if (refusals > 0) {
          refusals -= 1;
          throw tooMany(30);
        }
        return server.transport().pushUpdates(id, updates);
      },
    });
    const sync = await open(server, transport);

    sync.doc.getText('body').insert(0, 'patient');
    await expect(sync.flush()).rejects.toBeInstanceOf(ApiError);
    expect(sync.getState()).toMatchObject({ status: 'waiting', pending: 1 });

    sync.doc.getText('body').insert(7, ' typing');
    expect(sync.getState().status).toBe('waiting');
    await sync.flush();
    expect(calls.pushUpdates).toBe(1);

    await vi.advanceTimersByTimeAsync(29_000);
    expect(calls.pushUpdates).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);

    await vi.waitFor(() => expect(sync.getState()).toMatchObject({ status: 'synced', pending: 0 }));
    const reader = await open(server);
    expect(text(reader)).toBe('patient typing');
    sync.destroy();
    reader.destroy();
  });

  it('a refused compaction is not tried again before Retry-After', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const server = new FakeDocumentServer();
    const { transport, calls } = counted(server, {
      compact: async () => {
        throw tooMany(600);
      },
    });
    const sync = await open(server, transport, { compactThreshold: 1, compactWhileOpen: true });

    await write(sync, 'a');
    await vi.waitFor(() => expect(calls.compact).toBe(1));
    await settle();

    await write(sync, 'b');
    await settle();
    expect(calls.compact).toBe(1);

    await vi.advanceTimersByTimeAsync(600_000);
    await write(sync, 'c');
    await vi.waitFor(() => expect(calls.compact).toBe(2));
    sync.destroy();
  });
});

describe('the updates call', () => {
  it('a cold open whose snapshot went stale re-reads it before applying the log', async () => {
    const server = new FakeDocumentServer();
    const writer = await open(server);
    await write(writer, 'base');
    let stale = true;
    const { transport } = counted(server, {
      fetchDocument: async (id) => {
        const record = await server.transport().fetchDocument(id);
        if (stale) {
          stale = false;
          return { ...record, revision: record.revision - 1 };
        }
        return record;
      },
    });

    const reader = await open(server, transport);

    expect(text(reader)).toBe('base');
    expect(reader.getState().revision).toBe(server.revision);
    reader.destroy();
    writer.destroy();
  });

  it('gives up rather than loop when the document keeps being compacted', async () => {
    const server = new FakeDocumentServer();
    const { transport } = counted(server, {
      fetchUpdates: async () => {
        throw new RevisionChangedError(1, 2);
      },
    });
    const sync = new DocumentSync(server.id, transport, { debounceMs: 0, pollIntervalMs: 0 });

    await expect(sync.open()).rejects.toThrow('keeps being compacted');
    sync.destroy();
  });

  it('keeps the doc a plain Y.Doc', () => {
    expect(new DocumentSync('doc', new FakeDocumentServer().transport()).doc).toBeInstanceOf(Y.Doc);
  });
});
