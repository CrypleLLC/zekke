import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { FakeDocumentServer, TEST_DOCUMENT_DEK } from '@/test/document-server';
import { sealUpdate } from './crypto';
import { MAX_SNAPSHOT_CHARACTERS, MAX_UPDATE_CHARACTERS, SnapshotTooLargeError } from './records';
import { DocumentSync, type DocumentSyncOptions } from './sync';

async function open(server: FakeDocumentServer, options: DocumentSyncOptions = {}): Promise<DocumentSync> {
  const sync = new DocumentSync(server.id, server.transport(), { debounceMs: 0, pollIntervalMs: 0, ...options });
  await sync.open();
  return sync;
}

function randomText(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const parts: string[] = [];
  for (let offset = 0; offset < length; offset += 65_536) {
    const bytes = crypto.getRandomValues(new Uint8Array(Math.min(65_536, length - offset)));
    parts.push(Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join(''));
  }
  return parts.join('');
}

async function seed(server: FakeDocumentServer, build: (doc: Y.Doc) => void): Promise<void> {
  const doc = new Y.Doc();
  build(doc);
  server.snapshotCiphertext = await sealUpdate(Y.encodeStateAsUpdate(doc), TEST_DOCUMENT_DEK);
}

describe('a local update larger than one delta', () => {
  it('goes out as several deltas, each under the server ceiling, and another device rebuilds it', async () => {
    const server = new FakeDocumentServer();
    const writer = await open(server);
    writer.doc.transact(() => {
      const map = writer.doc.getMap<{ v: number; label: string }>('cells');
      for (let index = 0; index < 20_000; index += 1) {
        map.set(`cell${index}`, { v: index + 0.5, label: `row ${index}` });
      }
    });
    await writer.flush();

    expect(server.appended.length).toBeGreaterThan(1);
    for (const characters of server.appended) {
      expect(characters).toBeLessThanOrEqual(MAX_UPDATE_CHARACTERS);
    }

    const reader = await open(server);
    expect(reader.doc.getMap('cells').size).toBe(20_000);
    expect(reader.doc.getMap('cells').get('cell19999')).toEqual({ v: 19999.5, label: 'row 19999' });
    writer.destroy();
    reader.destroy();
  });

  it('splits one large array insertion, which Yjs merges into a single struct', async () => {
    const server = new FakeDocumentServer();
    const writer = await open(server);
    writer.doc.getArray<string>('rows').insert(0, Array.from({ length: 60_000 }, (_, index) => `r${index}`));
    await writer.flush();
    expect(server.appended.length).toBeGreaterThan(1);
    const reader = await open(server);
    expect(reader.doc.getArray('rows').toArray()).toEqual(writer.doc.getArray('rows').toArray());
    writer.destroy();
    reader.destroy();
  });
});

describe('the snapshot ceiling', () => {
  it('refuses to send a snapshot the server would refuse, and says so', async () => {
    const server = new FakeDocumentServer();
    const sync = await open(server);
    sync.doc.getText('text').insert(0, randomText(Math.ceil((MAX_SNAPSHOT_CHARACTERS * 3) / 4) + 10_000));
    await sync.flush();

    await expect(sync.compact()).rejects.toBeInstanceOf(SnapshotTooLargeError);
    expect(server.compactions).toEqual([]);
    expect(sync.getState().capacity).toBe('over');
    expect(sync.getState().sealedSnapshotCharacters).toBeGreaterThan(MAX_SNAPSHOT_CHARACTERS);
    expect(sync.shouldCompact()).toBe(false);
    sync.destroy();
  });

  it('reports a snapshot near the ceiling, and still sends it', async () => {
    const server = new FakeDocumentServer();
    const sync = await open(server);
    sync.doc.getText('text').insert(0, randomText(Math.floor(MAX_SNAPSHOT_CHARACTERS * 0.7)));
    await sync.flush();
    await sync.compact();
    expect(server.compactions).toHaveLength(1);
    expect(sync.getState().capacity).toBe('near');
    sync.destroy();
  });
});

describe('tracking size and compacting by it', () => {
  it('counts the snapshot it opened and every delta since', async () => {
    const server = new FakeDocumentServer();
    await seed(server, (doc) => doc.getText('text').insert(0, randomText(50_000)));
    const sync = await open(server);
    expect(sync.getState().snapshotBytes).toBeGreaterThan(50_000);
    expect(sync.getState().logBytes).toBe(0);
    sync.doc.getText('text').insert(0, 'hello');
    await sync.flush();
    expect(sync.getState().logBytes).toBeGreaterThan(0);
    expect(sync.estimatedBytes()).toBe(sync.getState().snapshotBytes + sync.getState().logBytes);

    const other = await open(server);
    expect(other.getState().logBytes).toBe(sync.getState().logBytes);
    sync.destroy();
    other.destroy();
  });

  it('keeps the count rule by default, so documents compact as they always did', async () => {
    const server = new FakeDocumentServer();
    const sync = await open(server, { compactThreshold: 3 });
    for (let index = 0; index < 3; index += 1) {
      sync.doc.getMap('m').set(`k${index}`, index);
      await sync.flush();
    }
    expect(sync.shouldCompact()).toBe(true);
    sync.destroy();
  });

  it('compacts by the log’s size against the snapshot’s when a ratio is set', async () => {
    const server = new FakeDocumentServer();
    await seed(server, (doc) => doc.getText('text').insert(0, randomText(40_000)));
    const sync = await open(server, { compactThreshold: 10_000, compactLogRatio: 0.25, compactMinLogBytes: 1000 });

    sync.doc.getMap('m').set('small', 1);
    await sync.flush();
    expect(sync.shouldCompact()).toBe(false);

    sync.doc.getText('text').insert(0, randomText(12_000));
    await sync.flush();
    expect(sync.shouldCompact()).toBe(true);

    await sync.compact();
    expect(sync.getState().logBytes).toBe(0);
    expect(sync.shouldCompact()).toBe(false);
    sync.destroy();
  });
});
