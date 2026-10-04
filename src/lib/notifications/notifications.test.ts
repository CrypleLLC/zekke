import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenStore } from '@/lib/api';
import {
  isKnownKind,
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  MAX_READ_IDS,
  unreadNotificationCount,
} from './index';

interface Call {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}

function mockFetch(...specs: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  let index = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method as string,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      const spec = specs[Math.min(index++, specs.length - 1)];
      const text = spec.body === undefined ? '' : JSON.stringify(spec.body);
      return {
        status: spec.status,
        ok: spec.status >= 200 && spec.status < 300,
        text: async () => text,
        headers: { get: () => null },
      } as unknown as Response;
    }),
  );

  return calls;
}

function context() {
  const tokens = new TokenStore();
  tokens.set('jwt-token');
  return { tokens };
}

function id(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listNotifications', () => {
  it('reads the page, the unread count and the next cursor', async () => {
    const calls = mockFetch({
      status: 200,
      body: {
        message: 'Notifications retrieved',
        data: {
          notifications: [
            { id: id(1), kind: 'expiring', params: { days: 7 }, created_at: '2026-10-03T10:00:00Z' },
            { id: id(2), kind: 'refunded', params: null, created_at: '2026-10-02T10:00:00Z', read_at: '2026-10-02T11:00:00Z' },
          ],
          unread_count: 1,
        },
        page: { has_more: true, next_cursor: 'bzoyMA' },
      },
    });

    const page = await listNotifications(context(), { cursor: 'bzoxMA' });

    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toContain('/notifications?');
    expect(calls[0].url).toContain('limit=20');
    expect(calls[0].url).toContain('cursor=bzoxMA');
    expect(page.unreadCount).toBe(1);
    expect(page.nextCursor).toBe('bzoyMA');
    expect(page.notifications[0].params).toEqual({ days: 7 });
    expect(page.notifications[1].params).toEqual({});
  });

  it('has no next cursor on the last page', async () => {
    mockFetch({ status: 200, body: { data: { notifications: [], unread_count: 0 }, page: { has_more: false } } });

    const page = await listNotifications(context());

    expect(page.nextCursor).toBeUndefined();
    expect(page.notifications).toEqual([]);
  });

  it('asks for one row to read the unread count', async () => {
    const calls = mockFetch({ status: 200, body: { data: { notifications: [], unread_count: 4 } } });

    expect(await unreadNotificationCount(context())).toBe(4);
    expect(calls[0].url).toContain('limit=1');
  });
});

describe('marking notifications read', () => {
  it('sends canonical ids once each, in batches the API accepts', async () => {
    const calls = mockFetch({ status: 204 });
    const ids = Array.from({ length: MAX_READ_IDS + 5 }, (_, n) => id(n + 1));

    await markNotificationsRead(context(), [...ids, ids[0]]);

    expect(calls).toHaveLength(2);
    expect(calls[0].body).toEqual({ ids: ids.slice(0, MAX_READ_IDS) });
    expect(calls[1].body).toEqual({ ids: ids.slice(MAX_READ_IDS) });
  });

  it('refuses an id it would have to rewrite', async () => {
    mockFetch({ status: 204 });

    await expect(markNotificationsRead(context(), ['0000000A-0000-4000-8000-00000000000B'])).rejects.toThrow();
  });

  it('marks everything read in one call', async () => {
    const calls = mockFetch({ status: 204 });

    await markAllNotificationsRead(context());

    expect(calls[0].url).toContain('/notifications/read');
    expect(calls[0].body).toEqual({ all: true });
  });
});

describe('isKnownKind', () => {
  it('knows the kinds the API sends', () => {
    expect(isKnownKind('data_loss_countdown')).toBe(true);
    expect(isKnownKind('lottery_won')).toBe(false);
  });
});
