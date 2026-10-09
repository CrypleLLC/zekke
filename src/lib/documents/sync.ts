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
  RevisionChangedError,
  SequenceGapError,
  SnapshotTooLargeError,
  assertContiguous,
  assertLogFollows,
  highestSeq,
  type AppendResult,
  type DocumentRecord,
  type PendingUpdate,
  type UpdatesPage,
} from "./records";

export const REMOTE_ORIGIN = Symbol("Zekke/documents/remote");
export const DEFAULT_DEBOUNCE_MS = 3000;
export const DEFAULT_MAX_WAIT_MS = 8000;
export const DEFAULT_POLL_INTERVAL_MS = 20_000;
export const DEFAULT_MAX_POLL_INTERVAL_MS = 60_000;
export const DEFAULT_RETRY_AFTER_SECONDS = 10;
export const MAX_HEAD_REFRESHES = 3;
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
  fetchUpdates(id: string, since: number): Promise<UpdatesPage>;
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
  reportAttachments?(id: string, ids: readonly string[]): Promise<void>;
}

export type SnapshotCapacity = "ok" | "near" | "over";

export type SyncStatus =
  | "idle"
  | "loading"
  | "synced"
  | "saving"
  | "offline"
  | "waiting"
  | "gone"
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
  maxPollIntervalMs?: number;
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
  private readonly maxPollIntervalMs: number;
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
  private pollTimer?: ReturnType<typeof setTimeout>;
  private polling = false;
  private pollDelay = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private compactBlockedUntil = 0;
  private gone = false;
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
    this.maxPollIntervalMs = Math.max(
      this.pollIntervalMs,
      options.maxPollIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS,
    );
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
      if (this.gone) {
        this.patch({ pending: this.pendingCount() });
        return;
      }
      this.patch({
        status: this.retryTimer === undefined ? "saving" : "waiting",
        pending: this.pendingCount(),
      });
      this.scheduleFlush();
    };
    this.doc.on("update", this.updateHandler);

    this.patch({ status: "synced" });
    this.compactIfDue();
  }

  async pull(
    options: { coldStart?: boolean; refreshes?: number } = {},
  ): Promise<number> {
    const dek = this.requireDek();
    const since = this.state.cursor;
    const refreshes = options.refreshes ?? 0;

    let page: UpdatesPage;
    try {
      page = await this.transport.fetchUpdates(this.id, since);
    } catch (error) {
      if (error instanceof RevisionChangedError) {
        return this.refreshHead(refreshes + 1);
      }
      if (isGone(error)) {
        this.markGone();
      }
      this.latchGap(error);
      throw error;
    }

    if (page.revision !== this.state.revision) {
      return this.refreshHead(refreshes + 1);
    }

    try {
      if (options.coldStart === true) {
        assertLogFollows(page.updates, this.state.snapshotSeq);
        this.logBase = page.updates.length > 0 ? page.updates[0].seq - 1 : 0;
      } else {
        assertContiguous(page.updates, { after: since });
      }
    } catch (error) {
      this.latchGap(error);
      throw error;
    }

    let logBytes = this.state.logBytes;
    for (const update of page.updates) {
      const bytes = await openUpdate(update.ciphertext, dek);
      try {
        Y.applyUpdate(this.doc, bytes, REMOTE_ORIGIN);
        logBytes += bytes.length;
      } finally {
        zeroBytes(bytes);
      }
    }

    this.patch({ cursor: highestSeq(since, page.updates), logBytes });
    return page.updates.length;
  }

  async poll(): Promise<boolean> {
    if (this.gone) {
      return false;
    }
    const before = { cursor: this.state.cursor, revision: this.state.revision };
    try {
      const applied = await this.pull();
      return (
        applied > 0 ||
        this.state.cursor !== before.cursor ||
        this.state.revision !== before.revision
      );
    } catch (error) {
      if (isGone(error)) {
        return false;
      }
      throw error;
    }
  }

  startPolling(): () => void {
    this.stopPolling();
    this.polling = true;
    this.pollDelay = this.pollIntervalMs;
    this.schedulePoll();
    return () => this.stopPolling();
  }

  stopPolling(): void {
    this.polling = false;
    if (this.pollTimer !== undefined) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  currentPollDelay(): number {
    return this.pollDelay;
  }

  private schedulePoll(): void {
    if (!this.polling || this.destroyed || this.gone) {
      return;
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.pollOnce();
    }, this.pollDelay);
    this.pollTimer.unref?.();
  }

  private async pollOnce(): Promise<void> {
    let changed = false;
    try {
      changed = await this.poll();
    } catch (error) {
      if (this.state.status !== "error") {
        this.markOffline(error);
      }
    }
    this.pollDelay = changed
      ? this.pollIntervalMs
      : Math.min(this.maxPollIntervalMs, this.pollDelay * 2);
    this.schedulePoll();
  }

  async flush(): Promise<void> {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.waitingSince = undefined;
    if (this.retryTimer !== undefined || this.gone) {
      return;
    }

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
        if (isRateLimited(error)) {
          this.waitToRetry(error.retryAfterSeconds);
        } else if (isGone(error)) {
          this.markGone();
        } else {
          this.markOffline(error);
        }
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
      if (isRateLimited(error)) {
        this.compactBlockedUntil =
          this.now() + (error.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS) * 1000;
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
    this.clearRetry();
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
      this.now() < this.compactBlockedUntil ||
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
    this.clearRetry();
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

  private async refreshHead(refreshes = 1): Promise<number> {
    if (refreshes > MAX_HEAD_REFRESHES) {
      throw new Error(
        "the document keeps being compacted elsewhere while it is read — try again shortly",
      );
    }
    const dek = this.requireDek();
    let record: DocumentRecord;
    try {
      record = await this.transport.fetchDocument(this.id);
    } catch (error) {
      if (isGone(error)) {
        this.markGone();
      }
      throw error;
    }
    const snapshotBytes = await this.applySnapshot(record, dek);

    this.patch({
      snapshotSeq: record.snapshot_seq,
      revision: record.revision,
      cursor: 0,
      snapshotBytes,
      logBytes: 0,
    });
    return 1 + (await this.pull({ coldStart: true, refreshes }));
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

  private latchGap(error: unknown): void {
    if (error instanceof SequenceGapError) {
      this.patch({
        gapDetected: true,
        status: "error",
        error: error.message,
      });
    }
  }

  private waitToRetry(retryAfterSeconds: number | undefined): void {
    this.clearRetry();
    this.patch({
      status: "waiting",
      pending: this.pendingCount(),
      error: undefined,
    });
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = undefined;
        void this.flush().catch(() => undefined);
      },
      (retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS) * 1000,
    );
    this.retryTimer.unref?.();
  }

  private clearRetry(): void {
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  private markGone(): void {
    this.gone = true;
    this.stopPolling();
    this.clearRetry();
    this.patch({ status: "gone", pending: this.pendingCount() });
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

function isRateLimited(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === "TOO_MANY_REQUESTS";
}

function isGone(error: unknown): boolean {
  return error instanceof ApiError && error.code === "NOT_FOUND";
}
