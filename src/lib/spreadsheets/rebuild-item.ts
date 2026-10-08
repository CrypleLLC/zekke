import * as Y from 'yjs';
import { createDocumentFromSnapshot, deleteDocument, listDocumentsMeta, type DocumentsContext } from '@/lib/documents/api';
import type { SyncState } from '@/lib/documents/sync';
import { zeroBytes } from '@/lib/encoding';
import { moveItemsToFolder } from '@/lib/folders/tree';
import { SNAPSHOT_RAW_BYTES_LIMIT } from './capacity';
import { META_MAP, REPLACED_BY_FIELD } from './layout';
import { rebuildSpreadsheet } from './rebuild';

export const REBUILD_OFFER_FRACTION = 0.8;

export class RebuildNotSyncedError extends Error {
  constructor() {
    super('the spreadsheet has edits this device has not saved or not received yet');
    this.name = 'RebuildNotSyncedError';
  }
}

export class RebuildTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`even without its history the spreadsheet is ${bytes} bytes, over what one snapshot can hold`);
    this.name = 'RebuildTooLargeError';
  }
}

export interface RebuildSource {
  readonly id: string;
  readonly doc: Y.Doc;
  flush(): Promise<void>;
  poll(): Promise<boolean>;
  getState(): SyncState;
}

export interface RebuildSteps {
  create(snapshot: Uint8Array): Promise<string>;
  folderOf(id: string): Promise<string | undefined>;
  moveToFolder(id: string, folderId: string): Promise<void>;
  trash(id: string): Promise<void>;
}

export interface RebuildEstimate {
  currentBytes: number;
  rebuiltBytes: number;
}

export interface RebuildResult {
  id: string;
  movedToFolder: boolean;
  trashed: boolean;
}

export function rebuildEstimate(doc: Y.Doc): RebuildEstimate {
  return {
    currentBytes: Y.encodeStateAsUpdate(doc).length,
    rebuiltBytes: Y.encodeStateAsUpdate(rebuildSpreadsheet(doc)).length,
  };
}

export function shouldOfferRebuild(
  state: Pick<SyncState, 'capacity' | 'snapshotBytes' | 'logBytes'>,
  limitBytes: number = SNAPSHOT_RAW_BYTES_LIMIT,
): boolean {
  return state.capacity !== 'ok' || state.snapshotBytes + state.logBytes >= limitBytes * REBUILD_OFFER_FRACTION;
}

export function isFullySynced(state: SyncState): boolean {
  return state.status === 'synced' && state.pending === 0 && !state.uploading && !state.gapDetected && state.error === undefined;
}

export async function rebuildSpreadsheetItem(source: RebuildSource, steps: RebuildSteps): Promise<RebuildResult> {
  await source.flush();
  await source.poll();
  if (!isFullySynced(source.getState())) {
    throw new RebuildNotSyncedError();
  }

  const snapshot = Y.encodeStateAsUpdate(rebuildSpreadsheet(source.doc));
  if (snapshot.length > SNAPSHOT_RAW_BYTES_LIMIT) {
    throw new RebuildTooLargeError(snapshot.length);
  }
  let id: string;
  try {
    id = await steps.create(snapshot);
  } finally {
    zeroBytes(snapshot);
  }

  let movedToFolder = false;
  try {
    const folderId = await steps.folderOf(source.id);
    if (folderId !== undefined) {
      await steps.moveToFolder(id, folderId);
      movedToFolder = true;
    }
  } catch {
    movedToFolder = false;
  }

  source.doc.getMap(META_MAP).set(REPLACED_BY_FIELD, id);
  let trashed = false;
  try {
    await source.flush();
    await steps.trash(source.id);
    trashed = true;
  } catch {
    trashed = false;
  }
  return { id, movedToFolder, trashed };
}

export function apiRebuildSteps(context: DocumentsContext): RebuildSteps {
  return {
    create: async (snapshot) => (await createDocumentFromSnapshot(context, snapshot)).id,
    folderOf: async (id) => (await listDocumentsMeta(context)).find((row) => row.id === id)?.folder_id,
    moveToFolder: async (id, folderId) => {
      await moveItemsToFolder(context, 'documents', [id], folderId);
    },
    trash: (id) => deleteDocument(context, id),
  };
}
