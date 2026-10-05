import * as Y from "yjs";
import { ApiError } from "@/lib/api";
import { zeroBytes } from "@/lib/encoding";
import { openUpdate, sealUpdate } from "./crypto";
import { splitUpdate } from "./split";
import { hasAttachments, referencedAttachmentIds } from "./attachments/map";
import { MAX_REFERENCED_ATTACHMENTS } from "./attachments/records";
import {
  MAX_SNAPSHOT_CHARACTERS,
  MAX_UPDATE_CHARACTERS,
  SNAPSHOT_NEAR_FRACTION,
  SequenceGapError,
  SnapshotTooLargeError,
  assertLogFollows,
  highestSeq,
  type AppendResult,
  type DocumentMetaRecord,
  type DocumentRecord,
  type DocumentUpdateRecord,
  type PendingUpdate,
} from "./records";

export const REMOTE_ORIGIN = Symbol("Zekke/documents/remote");
export const DEFAULT_DEBOUNCE_MS = 3000;
export const DEFAULT_MAX_WAIT_MS = 8000;
export const DEFAULT_POLL_INTERVAL_MS = 20_000;
export const DEFAULT_COMPACT_THRESHOLD = 64;
export const DOCUMENT_COMPACT_THRESHOLD = 200;

export const DOCUMENT_SYNC_OPTIONS = {
  compactThreshold: DOCUMENT_COMPACT_THRESHOLD,
  compactWhileOpen: true,
} as const;
export const MAX_UPDATE_RAW_BYTES =
  Math.floor((MAX_UPDATE_CHARACTERS * 3) / 4) - 64;

export interface DocumentTransport {
  fetchDocument(id: string): Promise<DocumentRecord>;
  fetchUpdates(
    id: string,
    since: number,
    options?: { expectFollowing?: boolean },
  ): Promise<DocumentUpdateRecord[]>;
  pushUpdates(
    id: string,
    updates: readonly PendingUpdate[],
  ): Promise<AppendResult>;
  compact(
    id: string,
    body: {
      snapshot_ciphertext: string;
      through_seq: number;
      expected_revision?: number;
    },
  ): Promise<DocumentRecord>;
  unwrapDek(
    document: Pick<DocumentRecord, "wrapped_dek" | "key_generation">,
  ): Promise<Uint8Array>;
  listMeta(): Promise<DocumentMetaRecord[]>;
  reportAttachments?(id: string, ids: readonly string[]): Promise<void>;
}

export type SnapshotCapacity = "ok" | "near" | "over";

export type SyncStatus =
  | "idle"
  | "loading"
  | "synced"
  | "saving"
  | "offline"
  | "error";

export interface SyncState {
  status: SyncStatus;
  cursor: number;
  snapshotSeq: number;
  revision: number;
  pending: number;
  uploading: boolean;
  lastSavedAt?: number;
  error?: string;
  gapDetected: boolean;
  snapshotBytes: number;
  logBytes: number;
  capacity: SnapshotCapacity;
  sealedSnapshotCharacters?: number;
}

export interface DocumentSyncOptions {
  debounceMs?: number;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  compactThreshold?: number;
  compactLogRatio?: number;
  compactMinLogBytes?: number;
  compactWhileOpen?: boolean;
  now?: () => number;
}

export class DocumentSync {
  readonly doc = new Y.Doc();
  readonly id: string;

  private readonly transport: DocumentTransport;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly pollIntervalMs: number;
  private readonly compactThreshold: number;
  private readonly compactLogRatio?: number;
  private readonly compactMinLogBytes: number;
  private readonly compactWhileOpen: boolean;
  private readonly now: () => number;
  private readonly listeners = new Set<(state: SyncState) => void>();

  private dek?: Uint8Array;
  private queued: Uint8Array[] = [];
  private inFlight?: PendingUpdate;
  private inFlightBytes = 0;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private waitingSince?: number;
  private pollTimer?: ReturnType<typeof setInterval>;
  private flushing?: Promise<void>;
  private compacting?: Promise<void>;
  private logBase = 0;
  private destroyed = false;
  private updateHandler?: (update: Uint8Array, origin: unknown) => void;

  private state: SyncState = {
    status: "idle",
    cursor: 0,
    snapshotSeq: 0,
    revision: 0,
    pending: 0,
    gapDetected: false,
    uploading: false,
    snapshotBytes: 0,
    logBytes: 0,
    capacity: "ok",
  };

  constructor(
    id: string,
    transport: DocumentTransport,
    options: DocumentSyncOptions = {},
  ) {
    this.id = id;
    this.transport = transport;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.maxWaitMs = Math.max(this.debounceMs, options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS);
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.compactThreshold =
      options.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD;
    this.compactLogRatio = options.compactLogRatio;
    this.compactMinLogBytes = options.compactMinLogBytes ?? 0;
    this.compactWhileOpen = options.compactWhileOpen ?? false;
    this.now = options.now ?? (() => Date.now());
  }

  getState(): SyncState {
    return this.state;
  }

  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => void this.listeners.delete(listener);
  }

  async open(): Promise<void> {
    this.patch({ status: "loading" });

    const record = await this.transport.fetchDocument(this.id);
    this.dek = await this.transport.unwrapDek(record);

    const snapshotBytes = await this.applySnapshot(record, this.dek);

    this.patch({
      snapshotSeq: record.snapshot_seq,
      revision: record.revision,
      cursor: 0,
      snapshotBytes,
      logBytes: 0,
    });

    await this.pull({ coldStart: true });

    this.updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN || this.destroyed) {
        return;
      }
      this.queued.push(update.slice());
      this.patch({ status: "saving", pending: this.pendingCount() });
      this.scheduleFlush();
    };
    this.doc.on("update", this.updateHandler);

    this.patch({ status: "synced" });
    this.compactIfDue();
  }

  async pull(options: { coldStart?: boolean } = {}): Promise<number> {
    const dek = this.requireDek();
    const since = this.state.cursor;

    let updates: DocumentUpdateRecord[];
    try {
      updates = await this.transport.fetchUpdates(this.id, since, {
        expectFollowing: options.coldStart !== true,
      });
      if (options.coldStart === true) {
        assertLogFollows(updates, this.state.snapshotSeq);
        this.logBase = updates.length > 0 ? updates[0].seq - 1 : 0;
      }
    } catch (error) {
      if (error instanceof SequenceGapError) {
        this.patch({
          gapDetected: true,
          status: "error",
          error: error.message,
        });
      }
      throw error;
    }

    let logBytes = this.state.logBytes;
    for (const update of updates) {
      const bytes = await openUpdate(update.ciphertext, dek);
      try {
        Y.applyUpdate(this.doc, bytes, REMOTE_ORIGIN);
        logBytes += bytes.length;
      } finally {
        zeroBytes(bytes);
      }
    }

    this.patch({ cursor: highestSeq(since, updates), logBytes });
    return updates.length;
  }

  async poll(): Promise<boolean> {
    const meta = (await this.transport.listMeta()).find(
      (entry) => entry.id === this.id,
    );
    if (meta === undefined) {
      return false;
    }
    if (meta.revision !== this.state.revision) {
      await this.refreshHead();
      return true;
    }
    if (meta.latest_seq <= this.state.cursor) {
      return false;
    }
    await this.pull();
    return true;
  }

  startPolling(): () => void {
    this.stopPolling();
    this.pollTimer = setInterval(
      () => void this.poll().catch(() => this.markOffline()),
      this.pollIntervalMs,
    );
    this.pollTimer.unref?.();
    return () => this.stopPolling();
  }

  stopPolling(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  async flush(): Promise<void> {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.waitingSince = undefined;

    const running = this.flushing;
    if (running !== undefined) {
      await running.catch(() => undefined);
    }
    if (this.inFlight === undefined && this.queued.length === 0) {
      return;
    }

    const pass = this.drain();
    this.flushing = pass;
    this.patch({ uploading: true });
    try {
      await pass;
    } finally {
      if (this.flushing === pass) {
        this.flushing = undefined;
        this.patch({ uploading: false });
      }
    }
    this.compactIfDue();
  }

  private async drain(): Promise<void> {
    while (this.inFlight !== undefined || this.queued.length > 0) {
      const batch = await this.takeBatch();
      if (batch === undefined) {
        return;
      }

      try {
        const result = await this.transport.pushUpdates(this.id, [batch]);
        this.inFlight = undefined;
        this.patch({
          logBytes: this.state.logBytes + this.inFlightBytes,
          cursor: this.cursorAfterAppend(result),
          status: this.pendingCount() > 0 ? "saving" : "synced",
          pending: this.pendingCount(),
          lastSavedAt: this.now(),
          error: undefined,
        });
      } catch (error) {
        this.inFlight = batch;
        this.markOffline(error);
        throw error;
      }
    }
  }

  async compact(): Promise<void> {
    if (this.state.gapDetected) {
      throw new Error(
        "refusing to compact: a gap in the update log means unmerged data is missing",
      );
    }

    const dek = this.requireDek();
    await this.flush();

    const through = this.state.cursor;
    if (through <= this.logBase) {
      return;
    }

    const snapshot = Y.encodeStateAsUpdate(this.doc);
    const snapshotBytes = snapshot.length;
    const references = hasAttachments(this.doc)
      ? referencedAttachmentIds(this.doc)
      : undefined;
    let installed: DocumentRecord;
    try {
      const sealed = await sealUpdate(snapshot, dek);
      this.patch({
        sealedSnapshotCharacters: sealed.length,
        capacity: snapshotCapacity(sealed.length),
      });
      if (sealed.length > MAX_SNAPSHOT_CHARACTERS) {
        throw new SnapshotTooLargeError(sealed.length);
      }
      installed = await this.transport.compact(this.id, {
        snapshot_ciphertext: sealed,
        through_seq: through,
        expected_revision: this.state.revision,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        await this.refreshHead();
        return;
      }
      throw error;
    } finally {
      zeroBytes(snapshot);
    }

    this.patch({
      snapshotSeq: installed.snapshot_seq,
      revision: installed.revision,
      cursor: 0,
      snapshotBytes,
      logBytes: 0,
    });

    await this.reportAttachments(references);
    await this.pull({ coldStart: true });
  }

  private async reportAttachments(references: string[] | undefined): Promise<void> {
    if (
      references === undefined ||
      references.length > MAX_REFERENCED_ATTACHMENTS ||
      this.transport.reportAttachments === undefined
    ) {
      return;
    }
    try {
      await this.transport.reportAttachments(this.id, references);
    } catch {
      return;
    }
  }

  shouldCompact(): boolean {
    if (this.state.gapDetected || this.state.capacity === "over") {
      return false;
    }
    const deltas = this.state.cursor - this.logBase;
    if (deltas <= 0) {
      return false;
    }
    if (deltas >= this.compactThreshold) {
      return true;
    }
    return (
      this.compactLogRatio !== undefined &&
      this.state.logBytes >=
        Math.max(
          this.compactMinLogBytes,
          this.compactLogRatio * this.state.snapshotBytes,
        )
    );
  }

  estimatedBytes(): number {
    return this.state.snapshotBytes + this.state.logBytes;
  }

  async close(): Promise<void> {
    this.stopPolling();
    try {
      await this.flush();
      if (!this.compactWhileOpen && this.shouldCompact()) {
        await this.compact();
      }
    } finally {
      this.destroy();
    }
  }

  private compactIfDue(): void {
    if (
      !this.compactWhileOpen ||
      this.destroyed ||
      this.compacting !== undefined ||
      this.pendingCount() > 0 ||
      !this.shouldCompact()
    ) {
      return;
    }
    const pass = this.compact()
      .catch(() => undefined)
      .finally(() => {
        if (this.compacting === pass) {
          this.compacting = undefined;
        }
      });
    this.compacting = pass;
  }

  destroy(): void {
    this.destroyed = true;
    this.stopPolling();
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.updateHandler !== undefined) {
      this.doc.off("update", this.updateHandler);
      this.updateHandler = undefined;
    }
    zeroBytes(this.dek);
    this.dek = undefined;
    for (const update of this.queued) {
      zeroBytes(update);
    }
    this.queued = [];
    this.doc.destroy();
    this.listeners.clear();
  }

  private cursorAfterAppend(result: AppendResult): number {
    return result.latest_seq === this.state.cursor + result.applied
      ? result.latest_seq
      : this.state.cursor;
  }

  private async refreshHead(): Promise<void> {
    const dek = this.requireDek();
    const record = await this.transport.fetchDocument(this.id);
    const snapshotBytes = await this.applySnapshot(record, dek);

    this.patch({
      snapshotSeq: record.snapshot_seq,
      revision: record.revision,
      cursor: 0,
      snapshotBytes,
      logBytes: 0,
    });
    await this.pull({ coldStart: true });
  }

  private async applySnapshot(
    record: DocumentRecord,
    dek: Uint8Array,
  ): Promise<number> {
    if (record.snapshot_ciphertext.length === 0) {
      return 0;
    }
    const snapshot = await openUpdate(record.snapshot_ciphertext, dek);
    try {
      Y.applyUpdate(this.doc, snapshot, REMOTE_ORIGIN);
      return snapshot.length;
    } finally {
      zeroBytes(snapshot);
    }
  }

  private async takeBatch(): Promise<PendingUpdate | undefined> {
    if (this.inFlight !== undefined) {
      return this.inFlight;
    }
    if (this.queued.length === 0) {
      return undefined;
    }

    if (this.queued[0].length > MAX_UPDATE_RAW_BYTES) {
      const oversized = this.queued[0];
      this.queued = [
        ...splitUpdate(oversized, MAX_UPDATE_RAW_BYTES),
        ...this.queued.slice(1),
      ];
      if (this.queued[0] !== oversized) {
        zeroBytes(oversized);
      }
    }

    const take = this.queued.length === 1 ? 1 : this.chunkSize();
    const chunk = this.queued.slice(0, take);
    this.queued = this.queued.slice(take);

    const merged = Y.mergeUpdates(chunk);

    try {
      const ciphertext = await sealUpdate(merged, this.requireDek());
      if (ciphertext.length > MAX_UPDATE_CHARACTERS) {
        throw new Error(
          `sealed update is ${ciphertext.length} characters, over the server ceiling of ` +
            `${MAX_UPDATE_CHARACTERS} — compact this document before editing further`,
        );
      }

      const pending: PendingUpdate = {
        client_update_id: crypto.randomUUID(),
        ciphertext,
      };
      this.inFlight = pending;
      this.inFlightBytes = merged.length;
      return pending;
    } finally {
      zeroBytes(merged);
      for (const update of chunk) {
        zeroBytes(update);
      }
    }
  }

  private chunkSize(): number {
    let bytes = 0;
    for (let index = 0; index < this.queued.length; index++) {
      bytes += this.queued[index].length;
      if (bytes > MAX_UPDATE_RAW_BYTES) {
        return Math.max(index, 1);
      }
    }
    return this.queued.length;
  }

  private scheduleFlush(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }
    const now = this.now();
    this.waitingSince ??= now;
    const delay = Math.max(
      0,
      Math.min(this.debounceMs, this.waitingSince + this.maxWaitMs - now),
    );
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.waitingSince = undefined;
      void this.flush().catch(() => undefined);
    }, delay);
    this.debounceTimer.unref?.();
  }

  private pendingCount(): number {
    return this.queued.length + (this.inFlight === undefined ? 0 : 1);
  }

  private markOffline(error?: unknown): void {
    this.patch({
      status: "offline",
      pending: this.pendingCount(),
      error: error instanceof Error ? error.message : undefined,
    });
  }

  private requireDek(): Uint8Array {
    if (this.dek === undefined) {
      throw new Error("document is not open — call open() before syncing");
    }
    return this.dek;
  }

  private patch(next: Partial<SyncState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

function snapshotCapacity(characters: number): SnapshotCapacity {
  if (characters > MAX_SNAPSHOT_CHARACTERS) {
    return "over";
  }
  return characters > MAX_SNAPSHOT_CHARACTERS * SNAPSHOT_NEAR_FRACTION
    ? "near"
    : "ok";
}
