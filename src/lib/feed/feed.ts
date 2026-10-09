import { ApiError } from '@/lib/api';
import { FEED_PAGE_LIMIT, type ChangesPage, type FeedScope } from './records';
import { ScopeReplica } from './replica';

export type ChangesFetcher = (scope: FeedScope, since: number, limit: number) => Promise<ChangesPage>;

export interface FeedOptions {
  limit?: number;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  maxPages?: number;
}

export const DEFAULT_FEED_POLL_MS = 30_000;
export const DEFAULT_FEED_MAX_POLL_MS = 120_000;
export const MAX_FEED_PAGES = 10_000;

export class Feed {
  private readonly replicas = new Map<FeedScope, ScopeReplica>();
  private readonly running = new Map<FeedScope, Promise<boolean>>();
  private readonly queued = new Map<FeedScope, Promise<boolean>>();
  private readonly listeners = new Map<FeedScope, Set<() => void>>();
  private readonly limit: number;
  private readonly pollIntervalMs: number;
  private readonly maxPollIntervalMs: number;
  private readonly maxPages: number;
  private polled: FeedScope[] = [];
  private pollTimer?: ReturnType<typeof setTimeout>;
  private pollDelay: number;
  private polling = false;

  constructor(
    private readonly fetcher: ChangesFetcher,
    options: FeedOptions = {},
  ) {
    this.limit = options.limit ?? FEED_PAGE_LIMIT;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_FEED_POLL_MS;
    this.maxPollIntervalMs = Math.max(this.pollIntervalMs, options.maxPollIntervalMs ?? DEFAULT_FEED_MAX_POLL_MS);
    this.maxPages = options.maxPages ?? MAX_FEED_PAGES;
    this.pollDelay = this.pollIntervalMs;
  }

  replica(scope: FeedScope): ScopeReplica {
    let replica = this.replicas.get(scope);
    if (replica === undefined) {
      replica = new ScopeReplica();
      this.replicas.set(scope, replica);
    }
    return replica;
  }

  sync(scope: FeedScope, options: { notify?: boolean } = {}): Promise<boolean> {
    const notify = options.notify ?? true;
    const running = this.running.get(scope);
    if (running !== undefined) {
      let queued = this.queued.get(scope);
      if (queued === undefined) {
        queued = running
          .catch(() => false)
          .then(() => {
            this.queued.delete(scope);
            return this.sync(scope, { notify });
          });
        this.queued.set(scope, queued);
      }
      return queued;
    }

    const pass = this.pull(scope)
      .then((changed) => {
        if (changed && notify) {
          this.emit(scope);
        }
        return changed;
      })
      .finally(() => this.running.delete(scope));
    this.running.set(scope, pass);
    return pass;
  }

  async syncAll(scopes: readonly FeedScope[]): Promise<boolean> {
    const outcomes = await Promise.allSettled(scopes.map((scope) => this.sync(scope)));
    return outcomes.some((outcome) => outcome.status === 'fulfilled' && outcome.value);
  }

  subscribe(scope: FeedScope, listener: () => void): () => void {
    let set = this.listeners.get(scope);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(scope, set);
    }
    set.add(listener);
    return () => void set.delete(listener);
  }

  startPolling(scopes: readonly FeedScope[]): void {
    this.stopPolling();
    this.polled = [...scopes];
    this.polling = true;
    this.pollDelay = this.pollIntervalMs;
    this.schedulePoll();
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
    if (!this.polling) {
      return;
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      void this.pollOnce();
    }, this.pollDelay);
    this.pollTimer.unref?.();
  }

  private async pollOnce(): Promise<void> {
    const changed = await this.syncAll(this.polled);
    this.pollDelay = changed ? this.pollIntervalMs : Math.min(this.maxPollIntervalMs, this.pollDelay * 2);
    this.schedulePoll();
  }

  private async pull(scope: FeedScope): Promise<boolean> {
    const replica = this.replica(scope);
    let changed = false;

    for (let page = 0; page < this.maxPages; page++) {
      let result: ChangesPage;
      try {
        result = await this.fetcher(scope, replica.cursor, this.limit);
      } catch (error) {
        if (isReset(error) && replica.cursor > 0) {
          replica.reset();
          changed = true;
          continue;
        }
        throw error;
      }

      changed = replica.apply(result.changes, result.cursor) || changed;
      if (!result.more) {
        const first = !replica.synced;
        replica.synced = true;
        return changed || first;
      }
    }

    throw new Error(`the ${scope} feed exceeded ${this.maxPages} pages — refusing to loop further`);
  }

  private emit(scope: FeedScope): void {
    for (const listener of this.listeners.get(scope) ?? []) {
      listener();
    }
  }
}

function isReset(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'RESET';
}
