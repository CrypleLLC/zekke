import { assertCanonicalUuid, request } from '@/lib/api';
import { requireToken, type TokenContext } from '@/lib/context';

export const NOTIFICATION_KINDS = [
  'purchase_succeeded',
  'subscription_renewed',
  'payment_failed',
  'refunded',
  'expiring',
  'grace_started',
  'data_loss_countdown',
  'data_deleted',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const MAX_READ_IDS = 200;
export const DEFAULT_NOTIFICATION_PAGE = 20;

export interface NotificationRecord {
  id: string;
  kind: string;
  params: Record<string, unknown>;
  created_at: string;
  read_at?: string;
}

export interface NotificationPage {
  notifications: NotificationRecord[];
  unreadCount: number;
  nextCursor?: string;
}

interface NotificationListing {
  notifications: NotificationRecord[];
  unread_count: number;
}

export function isKnownKind(kind: string): kind is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(kind);
}

export async function listNotifications(
  context: TokenContext,
  options: { limit?: number; cursor?: string } = {},
): Promise<NotificationPage> {
  const response = await request<NotificationListing>({
    method: 'GET',
    path: '/notifications',
    token: requireToken(context),
    query: { limit: options.limit ?? DEFAULT_NOTIFICATION_PAGE, cursor: options.cursor },
    timeoutMs: context.timeoutMs,
  });

  const page = response.page;
  return {
    notifications: (response.data?.notifications ?? []).map((record) => ({
      ...record,
      params: isObject(record.params) ? record.params : {},
    })),
    unreadCount: response.data?.unread_count ?? 0,
    nextCursor: page?.has_more === true ? page.next_cursor : undefined,
  };
}

export async function unreadNotificationCount(context: TokenContext): Promise<number> {
  return (await listNotifications(context, { limit: 1 })).unreadCount;
}

export async function markNotificationsRead(context: TokenContext, ids: readonly string[]): Promise<void> {
  const unique = [...new Set(ids)].map((id) => assertCanonicalUuid(id, 'notification id'));
  for (let start = 0; start < unique.length; start += MAX_READ_IDS) {
    await request({
      method: 'POST',
      path: '/notifications/read',
      body: { ids: unique.slice(start, start + MAX_READ_IDS) },
      token: requireToken(context),
      timeoutMs: context.timeoutMs,
    });
  }
}

export async function markAllNotificationsRead(context: TokenContext): Promise<void> {
  await request({
    method: 'POST',
    path: '/notifications/read',
    body: { all: true },
    token: requireToken(context),
    timeoutMs: context.timeoutMs,
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
