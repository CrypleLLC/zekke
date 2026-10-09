import {
  MAX_SNAPSHOT_CHARACTERS,
  MAX_UPDATE_CHARACTERS,
  assertContiguous,
  type AppendResult,
  type DocumentRecord,
  type DocumentTransport,
  type DocumentUpdateRecord,
  type PendingUpdate,
} from '@/lib/documents';

export const TEST_DOCUMENT_DEK = new Uint8Array(32).fill(7);

export class FakeDocumentServer {
  private log: DocumentUpdateRecord[] = [];
  private seen = new Set<string>();
  snapshotCiphertext = '';
  snapshotSeq = 0;
  revision = 1;
  appended: number[] = [];
  compactions: number[] = [];

  constructor(readonly id = 'doc') {}

  record(): DocumentRecord {
    return {
      id: this.id,
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
      if (pending.ciphertext.length > MAX_UPDATE_CHARACTERS) {
        throw new Error(`the server refuses a delta of ${pending.ciphertext.length} characters`);
      }
      if (this.seen.has(pending.client_update_id)) {
        skipped += 1;
        continue;
      }
      this.seen.add(pending.client_update_id);
      this.log.push({ seq: this.latestSeq() + 1, ciphertext: pending.ciphertext, created_at: '2026-01-01T00:00:00Z' });
      this.appended.push(pending.ciphertext.length);
      applied += 1;
    }
    return { applied, skipped, latest_seq: this.latestSeq() };
  }

  compact(snapshot: string, throughSeq: number): DocumentRecord {
    if (snapshot.length > MAX_SNAPSHOT_CHARACTERS) {
      throw new Error(`the server refuses a snapshot of ${snapshot.length} characters`);
    }
    if (throughSeq > this.latestSeq()) {
      throw new Error('through_seq ahead of the log');
    }
    this.snapshotCiphertext = snapshot;
    this.snapshotSeq = throughSeq;
    this.revision += 1;
    this.compactions.push(snapshot.length);
    this.log = this.log.filter((entry) => entry.seq > throughSeq);
    return this.record();
  }

  transport(): DocumentTransport {
    return {
      fetchDocument: async () => this.record(),
      fetchUpdates: async (_id, since) => {
        const updates = this.since(since);
        assertContiguous(updates);
        return { updates, revision: this.revision, snapshotSeq: this.snapshotSeq };
      },
      pushUpdates: async (_id, updates) => this.append(updates),
      compact: async (_id, body) => this.compact(body.snapshot_ciphertext, body.through_seq),
      unwrapDek: async () => TEST_DOCUMENT_DEK.slice(),
    };
  }
}
