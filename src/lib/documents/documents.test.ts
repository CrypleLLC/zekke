import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { buildActionPayload, normalizeActionArgs } from '@/lib/signing';
import { openBlob, sealBlob } from '@/lib/sealed';
import {
  MAX_UPDATE_CHARACTERS,
  SequenceGapError,
  assertContiguous,
  highestSeq,
  isContiguous,
  type AppendResult,
  type DocumentRecord,
  type DocumentUpdateRecord,
  type PendingUpdate,
} from './records';
import { DOCUMENT_SYNC_OPTIONS, DocumentSync, type DocumentTransport } from './sync';
import {
  isUntouched,
  readDocumentFont,
  readPageMargins,
  writeDocumentFont,
  writePageMargins,
  writeTitle,
} from './content';

const DEK = new Uint8Array(32).fill(7);

function update(seq: number, ciphertext = ''): DocumentUpdateRecord {
  return { seq, ciphertext, created_at: '2026-01-01T00:00:00Z' };
}

describe('the document base font', () => {
  it('is absent until written, and read back once written', () => {
    const doc = new Y.Doc();
    expect(readDocumentFont(doc)).toBeUndefined();
    writeDocumentFont(doc, 'Arial, sans-serif');
    expect(readDocumentFont(doc)).toBe('Arial, sans-serif');
  });

  it('counts a document as untouched only while no device has written to it', () => {
    const fresh = new Y.Doc();
    expect(isUntouched(fresh)).toBe(true);

    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(fresh));
    expect(isUntouched(copy)).toBe(true);

    const titled = new Y.Doc();
    writeTitle(titled, 'Lease');
    writeTitle(titled, '');
    expect(isUntouched(titled)).toBe(false);
  });
});

describe('the page margins', () => {
  it('are absent until written, and survive a round trip through an update', () => {
    const doc = new Y.Doc();
    expect(readPageMargins(doc)).toBeUndefined();
    writePageMargins(doc, { top: 30, right: 20, bottom: 20, left: 30 });

    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    expect(readPageMargins(copy)).toEqual({ top: 30, right: 20, bottom: 20, left: 30 });
  });

  it('store only the four sides', () => {
    const doc = new Y.Doc();
    const margins = { top: 1, right: 2, bottom: 3, left: 4, extra: 'x' };
    writePageMargins(doc, margins);
    expect(readPageMargins(doc)).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
  });
});

describe('sequence contiguity', () => {
  it('accepts a run that follows the cursor', () => {
    expect(isContiguous([update(4), update(5), update(6)], { after: 3 })).toBe(true);
  });

  it('rejects a hole inside the fetched range', () => {
    expect(() => assertContiguous([update(4), update(6)], { after: 3 })).toThrow(SequenceGapError);
  });

  it('rejects a range that does not start at the cursor', () => {
    expect(() => assertContiguous([update(6)], { after: 3 })).toThrow(SequenceGapError);
  });

  it('allows a range that starts above the cursor when the log was just pruned', () => {
    expect(isContiguous([update(6), update(7)])).toBe(true);
  });

  it('treats an empty range as contiguous', () => {
    expect(isContiguous([], { after: 9 })).toBe(true);
  });

  it('keeps the cursor when nothing came back', () => {
    expect(highestSeq(9, [])).toBe(9);
  });
});

describe('document-delete action', () => {
  it('sorts and de-duplicates ids before signing, as the batch route rebuilds them', () => {
    const ids = [
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      '1f2504e0-4f89-41d3-9a0c-0305e82c3301',
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    ];

    expect(normalizeActionArgs('document-delete', ids)).toEqual([
      '1f2504e0-4f89-41d3-9a0c-0305e82c3301',
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    ]);
  });

  it('builds the colon-joined payload the server rebuilds', () => {
    expect(buildActionPayload('chal', 1700000000, 'document-delete', ['a', 'b'])).toBe(
      'chal:1700000000:document-delete:a:b',
    );
  });
});

class FakeServer {
  private log: DocumentUpdateRecord[] = [];
  private seen = new Set<string>();
  snapshotCiphertext = '';
  snapshotSeq = 0;
  revision = 1;
  pushes = 0;

  record(): DocumentRecord {
    return {
      id: 'doc',
      wrapped_dek: 'wrapped',
      key_generation: 1,
      snapshot_ciphertext: this.snapshotCiphertext,
      snapshot_seq: this.snapshotSeq,
      revision: this.revision,
      version: 'v1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
  }

  latestSeq(): number {
    return this.log.reduce((highest, entry) => Math.max(highest, entry.seq), 0);
  }

  since(seq: number): DocumentUpdateRecord[] {
    return this.log.filter((entry) => entry.seq > seq);
  }

  append(updates: readonly PendingUpdate[]): AppendResult {
    let applied = 0;
    let skipped = 0;

    for (const pending of updates) {
      if (this.seen.has(pending.client_update_id)) {
        skipped += 1;
        continue;
      }
      this.seen.add(pending.client_update_id);
      this.log.push(update(this.latestSeq() + 1, pending.ciphertext));
      this.pushes += 1;
      applied += 1;
    }

    return { applied, skipped, latest_seq: this.latestSeq() };
  }

  compact(snapshot: string, throughSeq: number): DocumentRecord {
    if (throughSeq > this.latestSeq()) {
      throw new Error('through_seq ahead of the log');
    }
    this.snapshotCiphertext = snapshot;
    this.snapshotSeq = throughSeq;
    this.revision += 1;
    this.log = this.log.filter((entry) => entry.seq > throughSeq);
    return this.record();
  }

  dropUpdate(seq: number): void {
    this.log = this.log.filter((entry) => entry.seq !== seq);
  }
}

function transportFor(server: FakeServer): DocumentTransport {
  return {
    fetchDocument: async () => server.record(),
    fetchUpdates: async (_id, since) => {
      const updates = server.since(since);
      assertContiguous(updates);
      return { updates, revision: server.revision, snapshotSeq: server.snapshotSeq };
    },
    pushUpdates: async (_id, updates) => server.append(updates),
    compact: async (_id, body) => server.compact(body.snapshot_ciphertext, body.through_seq),
    unwrapDek: async () => DEK.slice(),
  };
}

function textOf(sync: DocumentSync): string {
  return sync.doc.getXmlFragment('default').toString();
}

async function openSync(server: FakeServer): Promise<DocumentSync> {
  const sync = new DocumentSync('doc', transportFor(server), { debounceMs: 0, pollIntervalMs: 0 });
  await sync.open();
  return sync;
}

describe('DocumentSync', () => {
  it('seals every delta before it leaves the device', async () => {
    const server = new FakeServer();
    const sync = await openSync(server);

    sync.doc.getText('body').insert(0, 'hello');
    await sync.flush();

    const [stored] = server.since(0);
    expect(stored.ciphertext).not.toContain('hello');

    const opened = await openBlob(stored.ciphertext, DEK);
    const mirror = new Y.Doc();
    Y.applyUpdate(mirror, opened);
    expect(mirror.getText('body').toString()).toBe('hello');

    sync.destroy();
  });

  it('carries an edit from one device to another through the log', async () => {
    const server = new FakeServer();
    const laptop = await openSync(server);

    laptop.doc.getText('body').insert(0, 'from the laptop');
    await laptop.flush();

    const phone = await openSync(server);
    expect(phone.doc.getText('body').toString()).toBe('from the laptop');

    laptop.destroy();
    phone.destroy();
  });

  it('converges when two devices edit concurrently', async () => {
    const server = new FakeServer();
    const laptop = await openSync(server);
    const phone = await openSync(server);

    laptop.doc.getText('body').insert(0, 'laptop ');
    phone.doc.getText('body').insert(0, 'phone ');
    await laptop.flush();
    await phone.flush();

    await laptop.pull();
    await phone.pull();

    expect(laptop.doc.getText('body').toString()).toBe(phone.doc.getText('body').toString());
    expect(laptop.doc.getText('body').toString()).toContain('laptop');
    expect(laptop.doc.getText('body').toString()).toContain('phone');

    laptop.destroy();
    phone.destroy();
  });

  it('reuses the client_update_id on retry so a replay costs no sequence number', async () => {
    const server = new FakeServer();
    const sync = await openSync(server);

    let failures = 1;
    const flaky: DocumentTransport = {
      ...transportFor(server),
      pushUpdates: async (id, updates) => {
        if (failures > 0) {
          failures -= 1;
          server.append(updates);
          throw new Error('network dropped after the server committed');
        }
        return server.append(updates);
      },
    };

    const retrying = new DocumentSync('doc', flaky, { debounceMs: 0, pollIntervalMs: 0 });
    await retrying.open();
    retrying.doc.getText('body').insert(0, 'once');

    await expect(retrying.flush()).rejects.toThrow('network dropped');
    await retrying.flush();

    expect(server.since(0)).toHaveLength(1);

    sync.destroy();
    retrying.destroy();
  });

  it('reports uploading only while a push is on its way, and pending until it lands', async () => {
    const server = new FakeServer();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: DocumentTransport = {
      ...transportFor(server),
      pushUpdates: async (_id, updates) => {
        await gate;
        return server.append(updates);
      },
    };

    const sync = new DocumentSync('doc', slow, { debounceMs: 60_000, pollIntervalMs: 0 });
    await sync.open();
    expect(sync.getState()).toMatchObject({ status: 'synced', pending: 0, uploading: false });

    sync.doc.getText('body').insert(0, 'typed');
    expect(sync.getState()).toMatchObject({ pending: 1, uploading: false });

    const flushing = sync.flush();
    expect(sync.getState()).toMatchObject({ pending: 1, uploading: true });

    release();
    await flushing;
    expect(sync.getState()).toMatchObject({ status: 'synced', pending: 0, uploading: false });

    sync.destroy();
  });

  describe('compacting while the document is open', () => {
    async function editor(server: FakeServer, threshold = 3) {
      const sync = new DocumentSync('doc', transportFor(server), {
        debounceMs: 0,
        pollIntervalMs: 0,
        compactThreshold: threshold,
        compactWhileOpen: true,
      });
      await sync.open();
      return sync;
    }

    async function settle(sync: DocumentSync) {
      await vi.waitFor(() => expect(sync.getState().pending).toBe(0));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    it('is how the document editor runs: 200 deltas, compacted while open', () => {
      expect(DOCUMENT_SYNC_OPTIONS).toEqual({ compactThreshold: 200, compactWhileOpen: true });
    });

    it('compacts as soon as a push brings the log to the threshold', async () => {
      const server = new FakeServer();
      const sync = await editor(server);

      for (const word of ['one ', 'two ', 'three ']) {
        sync.doc.getText('body').insert(0, word);
        await sync.flush();
      }
      await settle(sync);

      expect(server.revision).toBe(2);
      expect(server.since(0)).toHaveLength(0);
      expect(sync.getState()).toMatchObject({ revision: 2, cursor: 0, snapshotSeq: 3 });

      const reader = await openSync(server);
      expect(reader.doc.getText('body').toString()).toBe('three two one ');

      sync.destroy();
      reader.destroy();
    });

    it('leaves a log below the threshold alone', async () => {
      const server = new FakeServer();
      const sync = await editor(server);

      for (const word of ['one ', 'two ']) {
        sync.doc.getText('body').insert(0, word);
        await sync.flush();
      }
      await settle(sync);

      expect(server.revision).toBe(1);
      expect(server.since(0)).toHaveLength(2);

      sync.destroy();
    });

    it('compacts on opening a document whose log is already over the threshold', async () => {
      const server = new FakeServer();
      const writer = await openSync(server);
      for (const word of ['a', 'b', 'c', 'd']) {
        writer.doc.getText('body').insert(0, word);
        await writer.flush();
      }
      writer.destroy();
      expect(server.since(0)).toHaveLength(4);

      const sync = await editor(server);
      await settle(sync);

      expect(server.revision).toBe(2);
      expect(server.since(0)).toHaveLength(0);
      expect(sync.doc.getText('body').toString()).toBe('dcba');

      sync.destroy();
    });

    it('does not compact on close, since a closed tab would never get that far', async () => {
      const server = new FakeServer();
      const sync = await editor(server, 1000);
      sync.doc.getText('body').insert(0, 'kept in the log');
      await sync.close();

      expect(server.revision).toBe(1);
      expect(server.since(0)).toHaveLength(1);
    });

    it('still compacts on close where compacting while open is off, as spreadsheets run', async () => {
      const server = new FakeServer();
      const sync = new DocumentSync('doc', transportFor(server), {
        debounceMs: 0,
        pollIntervalMs: 0,
        compactThreshold: 1,
      });
      await sync.open();
      sync.doc.getText('body').insert(0, 'compacted on close');
      await sync.flush();
      expect(server.revision).toBe(1);

      await sync.close();
      expect(server.revision).toBe(2);
    });
  });

  describe('when it pushes', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function typing() {
      const sync = new DocumentSync('doc', transportFor(new FakeServer()), {
        debounceMs: 1500,
        maxWaitMs: 8000,
        pollIntervalMs: 0,
      });
      await sync.open();
      vi.useFakeTimers();
      const flush = vi.spyOn(sync, 'flush').mockResolvedValue();
      const type = (text: string) => sync.doc.getText('body').insert(0, text);
      return { sync, flush, type };
    }

    it('waits for a pause in the typing before pushing', async () => {
      const { sync, flush, type } = await typing();

      type('a');
      await vi.advanceTimersByTimeAsync(1000);
      type('b');
      await vi.advanceTimersByTimeAsync(1000);
      expect(flush).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(600);
      expect(flush).toHaveBeenCalledTimes(1);

      sync.destroy();
    });

    it('pushes after the longest wait even when the typing never pauses', async () => {
      const { sync, flush, type } = await typing();

      for (let elapsed = 0; elapsed < 7500; elapsed += 500) {
        type('x');
        await vi.advanceTimersByTimeAsync(500);
      }
      expect(flush).not.toHaveBeenCalled();

      type('x');
      await vi.advanceTimersByTimeAsync(500);
      expect(flush).toHaveBeenCalledTimes(1);

      for (let elapsed = 0; elapsed < 7500; elapsed += 500) {
        type('y');
        await vi.advanceTimersByTimeAsync(500);
      }
      expect(flush).toHaveBeenCalledTimes(1);

      type('y');
      await vi.advanceTimersByTimeAsync(500);
      expect(flush).toHaveBeenCalledTimes(2);

      sync.destroy();
    });
  });

  it('waits for a debounced flush already in flight rather than returning early', async () => {
    const server = new FakeServer();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const slow: DocumentTransport = {
      ...transportFor(server),
      pushUpdates: async (_id, updates) => {
        await gate;
        return server.append(updates);
      },
    };

    const sync = new DocumentSync('doc', slow, { debounceMs: 0, pollIntervalMs: 0 });
    await sync.open();

    sync.doc.getText('body').insert(0, 'first');
    const debounced = sync.flush();

    sync.doc.getText('body').insert(0, 'second ');
    const explicit = sync.flush();

    release();
    await Promise.all([debounced, explicit]);

    expect(sync.getState().pending).toBe(0);
    expect(server.since(0)).toHaveLength(2);

    sync.destroy();
  });

  it('resets the cursor after compacting, because a full prune restarts seq at 1', async () => {
    const server = new FakeServer();
    const sync = await openSync(server);

    sync.doc.getText('body').insert(0, 'before compaction');
    await sync.flush();
    expect(server.latestSeq()).toBe(1);

    await sync.compact();
    expect(server.snapshotSeq).toBe(1);
    expect(sync.getState().cursor).toBe(0);

    sync.doc.getText('body').insert(0, 'after ');
    await sync.flush();
    expect(server.latestSeq()).toBe(1);

    const cold = await openSync(server);
    expect(cold.doc.getText('body').toString()).toBe('after before compaction');

    sync.destroy();
    cold.destroy();
  });

  it('refuses to compact once a gap has been seen', async () => {
    const server = new FakeServer();
    const sync = await openSync(server);

    for (const word of ['one', 'two', 'three']) {
      sync.doc.getText('body').insert(0, word);
      await sync.flush();
    }

    server.dropUpdate(2);

    const cold = new DocumentSync('doc', transportFor(server), {
      debounceMs: 0,
      pollIntervalMs: 0,
    });
    await expect(cold.open()).rejects.toThrow(SequenceGapError);
    expect(cold.getState().gapDetected).toBe(true);
    await expect(cold.compact()).rejects.toThrow('refusing to compact');

    sync.destroy();
    cold.destroy();
  });

  it('keeps a delta under the server ceiling', async () => {
    const server = new FakeServer();
    const sync = await openSync(server);

    sync.doc.getText('body').insert(0, 'x'.repeat(1000));
    await sync.flush();

    for (const stored of server.since(0)) {
      expect(stored.ciphertext.length).toBeLessThanOrEqual(MAX_UPDATE_CHARACTERS);
    }

    sync.destroy();
  });

  it('reports pending work while offline and drains it on reconnect', async () => {
    const server = new FakeServer();
    let online = false;

    const flaky: DocumentTransport = {
      ...transportFor(server),
      pushUpdates: async (id, updates) => {
        if (!online) {
          throw new Error('offline');
        }
        return server.append(updates);
      },
    };

    const sync = new DocumentSync('doc', flaky, { debounceMs: 0, pollIntervalMs: 0 });
    await sync.open();

    sync.doc.getText('body').insert(0, 'written on a plane');
    await expect(sync.flush()).rejects.toThrow('offline');
    expect(sync.getState().status).toBe('offline');
    expect(sync.getState().pending).toBe(1);

    online = true;
    await sync.flush();
    expect(sync.getState().status).toBe('synced');
    expect(sync.getState().pending).toBe(0);
    expect(server.since(0)).toHaveLength(1);

    sync.destroy();
  });

  it('restores an XML fragment from a snapshot alone', async () => {
    const server = new FakeServer();
    const sync = await openSync(server);

    const fragment = sync.doc.getXmlFragment('default');
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText('a document body')]);
    fragment.insert(0, [paragraph]);

    await sync.flush();
    await sync.compact();
    expect(server.since(0)).toHaveLength(0);
    expect(server.snapshotCiphertext.length).toBeGreaterThan(0);

    const cold = await openSync(server);
    expect(textOf(cold)).toContain('a document body');

    sync.destroy();
    cold.destroy();
  });

  it('seals the snapshot too', async () => {
    const server = new FakeServer();
    const sync = await openSync(server);

    sync.doc.getText('body').insert(0, 'secret prose');
    await sync.flush();
    await sync.compact();

    expect(server.snapshotCiphertext).not.toContain('secret prose');
    const opened = await openBlob(server.snapshotCiphertext, DEK);
    const mirror = new Y.Doc();
    Y.applyUpdate(mirror, opened);
    expect(mirror.getText('body').toString()).toBe('secret prose');

    sync.destroy();
  });

  it('re-reads the head instead of overwriting when compaction hits a stale revision', async () => {
    const server = new FakeServer();
    const sync = await openSync(server);

    sync.doc.getText('body').insert(0, 'mine');
    await sync.flush();

    const conflicting: DocumentTransport = {
      ...transportFor(server),
      compact: async () => {
        const error = new Error('conflict') as Error & { code: string };
        error.code = 'CONFLICT';
        throw error;
      },
    };

    const stale = new DocumentSync('doc', conflicting, { debounceMs: 0, pollIntervalMs: 0 });
    await stale.open();
    await expect(stale.compact()).rejects.toThrow('conflict');
    expect(server.snapshotSeq).toBe(0);

    sync.destroy();
    stale.destroy();
  });

  it('round-trips a sealed blob through the document DEK', async () => {
    const sealed = await sealBlob(new Uint8Array([1, 2, 3]), DEK);
    expect(Array.from(await openBlob(sealed, DEK))).toEqual([1, 2, 3]);
  });
});

describe('compacting after the log restarted', () => {
  it('compacts again once the server numbers a fresh log from 1, below the snapshot it follows', async () => {
    const server = new FakeServer();
    const sync = new DocumentSync('doc', transportFor(server), { debounceMs: 0, pollIntervalMs: 0 });
    await sync.open();

    for (const word of ['a', 'b', 'c']) {
      sync.doc.getText('body').insert(0, word);
      await sync.flush();
    }
    await sync.compact();
    expect(server.revision).toBe(2);

    sync.doc.getText('body').insert(0, 'd');
    await sync.flush();
    expect(server.since(0).map((update) => update.seq)).toEqual([1]);
    expect(sync.shouldCompact()).toBe(false);

    await sync.compact();

    expect(server.revision).toBe(3);
    expect(server.since(0)).toHaveLength(0);
    const reader = await openSync(server);
    expect(reader.doc.getText('body').toString()).toBe('dcba');
    reader.destroy();
    sync.destroy();
  });
});

describe('reporting attachment references at compaction', () => {
  const IMAGE = '5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
  const THUMB = '6c2f3d4e-5b6a-4c7d-9e8f-0a1b2c3d4e5f';
  const ENTRY = {
    key: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
    size: 10,
    stored: 65573,
    mime: 'image/webp',
    width: 4,
    height: 3,
  };

  async function compacting(server: FakeServer, report: DocumentTransport['reportAttachments']) {
    const sync = new DocumentSync(
      'doc',
      { ...transportFor(server), reportAttachments: report },
      { debounceMs: 0, pollIntervalMs: 0 },
    );
    await sync.open();
    return sync;
  }

  it('names the images the snapshot still shows, with their thumbnails', async () => {
    const server = new FakeServer();
    const report = vi.fn(async () => undefined);
    const sync = await compacting(server, report);

    sync.doc.transact(() => {
      sync.doc.getMap('attachments').set(IMAGE, { ...ENTRY, thumbnail: THUMB });
      sync.doc.getMap('attachments').set(THUMB, ENTRY);
      const image = new Y.XmlElement('image');
      image.setAttribute('attachment', IMAGE);
      sync.doc.getXmlFragment('body').insert(0, [image]);
    });
    await sync.flush();
    await sync.compact();

    expect(report).toHaveBeenCalledWith('doc', [IMAGE, THUMB].sort());
    sync.destroy();
  });

  it('reports an empty list once the last image is gone, and nothing for a document that never had one', async () => {
    const server = new FakeServer();
    const report = vi.fn(async () => undefined);
    const sync = await compacting(server, report);

    sync.doc.getText('body').insert(0, 'words only');
    await sync.flush();
    await sync.compact();
    expect(report).not.toHaveBeenCalled();
    sync.destroy();

    const emptied = await compacting(new FakeServer(), report);
    emptied.doc.getMap('attachments').set(IMAGE, ENTRY);
    await emptied.flush();
    await emptied.compact();
    expect(report).toHaveBeenCalledWith('doc', []);
    emptied.destroy();
  });

  it('never lets a failed report fail the compaction', async () => {
    const server = new FakeServer();
    const sync = await compacting(server, async () => {
      throw new Error('offline');
    });

    sync.doc.getMap('attachments').set(IMAGE, ENTRY);
    await sync.flush();
    await expect(sync.compact()).resolves.toBeUndefined();
    expect(server.revision).toBe(2);
    sync.destroy();
  });
});
