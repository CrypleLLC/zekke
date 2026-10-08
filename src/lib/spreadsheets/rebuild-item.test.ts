import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocumentSync, type SyncState } from '@/lib/documents';
import { FakeDocumentServer } from '@/test/document-server';
import {
  REPLACED_BY_FIELD,
  RebuildNotSyncedError,
  RebuildTooLargeError,
  SNAPSHOT_RAW_BYTES_LIMIT,
  isSpreadsheet,
  newSpreadsheetDoc,
  readReplacedBy,
  readSheets,
  rebuildSpreadsheetItem,
  shouldOfferRebuild,
  type RebuildSource,
  type RebuildSteps,
} from './index';

const NEW_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

async function openSheet(server: FakeDocumentServer): Promise<DocumentSync> {
  const sync = new DocumentSync(server.id, server.transport(), { debounceMs: 0, pollIntervalMs: 0 });
  await sync.open();
  Y.applyUpdate(sync.doc, Y.encodeStateAsUpdate(newSpreadsheetDoc()));
  await sync.flush();
  return sync;
}

function recordingSteps(overrides: Partial<RebuildSteps> = {}) {
  const calls: string[] = [];
  let created: Uint8Array | undefined;
  const steps: RebuildSteps = {
    create: async (snapshot) => {
      created = snapshot.slice();
      calls.push('create');
      return NEW_ID;
    },
    folderOf: async () => {
      calls.push('folderOf');
      return 'folder-1';
    },
    moveToFolder: async (id, folderId) => {
      calls.push(`move ${id} ${folderId}`);
    },
    trash: async (id) => {
      calls.push(`trash ${id}`);
    },
    ...overrides,
  };
  return { steps, calls, created: () => created };
}

describe('rebuilding a spreadsheet item', () => {
  it('creates the copy, puts it in the same folder, points the old one at it, then trashes the old one', async () => {
    const server = new FakeDocumentServer('3f2504e0-4f89-41d3-9a0c-0305e82c3302');
    const sync = await openSheet(server);
    const { steps, calls, created } = recordingSteps();

    const result = await rebuildSpreadsheetItem(sync, steps);

    expect(result).toEqual({ id: NEW_ID, movedToFolder: true, trashed: true });
    expect(calls).toEqual(['create', 'folderOf', `move ${NEW_ID} folder-1`, `trash ${server.id}`]);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, created()!);
    expect(isSpreadsheet(copy)).toBe(true);
    expect(readSheets(copy).map(({ id }) => id)).toEqual(readSheets(sync.doc).map(({ id }) => id));
    expect(copy.getMap('meta').has(REPLACED_BY_FIELD)).toBe(false);

    const other = new DocumentSync(server.id, server.transport(), { debounceMs: 0, pollIntervalMs: 0 });
    await other.open();
    expect(readReplacedBy(other.doc)).toBe(NEW_ID);
    sync.destroy();
    other.destroy();
  });

  it('refuses from a device that has not saved or received everything', async () => {
    const server = new FakeDocumentServer();
    const sync = await openSheet(server);
    const unsynced: RebuildSource = {
      id: sync.id,
      doc: sync.doc,
      flush: async () => undefined,
      poll: async () => false,
      getState: (): SyncState => ({ ...sync.getState(), pending: 1 }),
    };
    const { steps, calls } = recordingSteps();
    await expect(rebuildSpreadsheetItem(unsynced, steps)).rejects.toBeInstanceOf(RebuildNotSyncedError);
    await expect(
      rebuildSpreadsheetItem({ ...unsynced, getState: () => ({ ...sync.getState(), gapDetected: true }) }, steps),
    ).rejects.toBeInstanceOf(RebuildNotSyncedError);
    expect(calls).toEqual([]);
    sync.destroy();
  });

  it('still opens the copy when the old one cannot be trashed or the folder is gone', async () => {
    const server = new FakeDocumentServer();
    const sync = await openSheet(server);
    const { steps } = recordingSteps({
      moveToFolder: async () => {
        throw new Error('folder gone');
      },
      trash: async () => {
        throw new Error('offline');
      },
    });
    expect(await rebuildSpreadsheetItem(sync, steps)).toEqual({ id: NEW_ID, movedToFolder: false, trashed: false });
    sync.destroy();
  });

  it('creates nothing when the content alone would not fit in a snapshot', async () => {
    const server = new FakeDocumentServer();
    const sync = await openSheet(server);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(sync.doc));
    doc.getMap('meta').set('padding', 'x'.repeat(SNAPSHOT_RAW_BYTES_LIMIT));
    const oversized: RebuildSource = {
      id: sync.id,
      doc,
      flush: async () => undefined,
      poll: async () => false,
      getState: () => sync.getState(),
    };
    const { steps, calls } = recordingSteps();
    await expect(rebuildSpreadsheetItem(oversized, steps)).rejects.toBeInstanceOf(RebuildTooLargeError);
    expect(calls).toEqual([]);
    sync.destroy();
  });
});

describe('offering a rebuild', () => {
  it('starts at 80 % of the snapshot limit, counting the unsaved log, and whenever the capacity warns', () => {
    const limit = 1000;
    expect(shouldOfferRebuild({ capacity: 'ok', snapshotBytes: 700, logBytes: 99 }, limit)).toBe(false);
    expect(shouldOfferRebuild({ capacity: 'ok', snapshotBytes: 700, logBytes: 100 }, limit)).toBe(true);
    expect(shouldOfferRebuild({ capacity: 'near', snapshotBytes: 0, logBytes: 0 }, limit)).toBe(true);
  });
});
