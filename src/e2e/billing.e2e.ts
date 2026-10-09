import { beforeAll, describe, expect, it } from 'vitest';
import { getBaseUrl, request, TokenStore } from '@/lib/api';
import { completeSignUp, draftSignUp, type AccountServices } from '@/lib/account';
import { requireToken, type AuthedContext } from '@/lib/context';
import { memoryDeviceStore } from '@/lib/device/store';
import { generateMnemonic } from '@/lib/keys';
import { listNotifications, markNotificationsRead, unreadNotificationCount } from '@/lib/notifications';
import { SessionKeystore } from '@/lib/session';
import { getMe } from '@/lib/users';
import { asBilling, ticketSubject } from './plan';

const RECONCILE_TOKEN = process.env.ZEKKE_E2E_RECONCILE_TOKEN ?? 'local-reconcile-token-0123456789abcdef';

async function signUp(): Promise<AuthedContext> {
  const services: AccountServices = {
    session: new SessionKeystore({ idleTimeoutMs: 0 }),
    tokens: new TokenStore(),
    store: memoryDeviceStore(),
  };
  await completeSignUp(services, await draftSignUp(generateMnemonic(12)), { pin: '482915', paranoid: false });
  return { session: services.session, tokens: services.tokens, paranoid: false };
}


describe('plans and notifications, against a live API', () => {
  let ctx: AuthedContext;
  let billingRef: string;

  beforeAll(async () => {
    ctx = await signUp();
  });

  it('starts every account on the free plan', async () => {
    const { plan } = await getMe(ctx);
    expect(plan).toEqual({
      code: 'free',
      state: 'free',
      renews: false,
      storage_quota_bytes: 524_288_000,
      retention_days: 0,
      features: [],
    });
  });

  it('issues a billing ticket naming a random reference, the same one each time', async () => {
    const first = await request<{ ticket: string; expires_at: string }>({
      method: 'POST',
      path: '/billing/ticket',
      token: requireToken(ctx),
    });
    const second = await request<{ ticket: string }>({ method: 'POST', path: '/billing/ticket', token: requireToken(ctx) });

    billingRef = ticketSubject(first.data.ticket);
    expect(billingRef).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(ticketSubject(second.data.ticket)).toBe(billingRef);
    expect((await getMe(ctx)).uuid).not.toBe(billingRef);
  });

  it('raises the limits when billing reports a paid plan, and ignores an older report', async () => {
    const paidUntil = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    expect((await asBilling('PUT', `/internal/entitlements/${billingRef}`, {
      plan: 'premium_1', paid_until: paidUntil, renews: true, version: 2,
    })).status).toBe(204);
    expect((await asBilling('PUT', `/internal/entitlements/${billingRef}`, {
      plan: 'premium_2', paid_until: paidUntil, renews: true, version: 1,
    })).status).toBe(204);

    const account = await getMe(ctx);
    expect(account.plan).toMatchObject({
      code: 'premium_1',
      state: 'active',
      renews: true,
      storage_quota_bytes: 100_000_000_000,
      retention_days: 30,
      features: ['inbox'],
    });
    expect(account.retention_days).toBe(30);
  });

  it('answers an unknown reference with its own code, and a wrong token without it', async () => {
    const unknown = await asBilling('PUT', '/internal/entitlements/00000000-0000-4000-8000-0000000000ff', {
      plan: 'premium_1', paid_until: new Date().toISOString(), version: 1,
    });
    expect(unknown).toEqual({ status: 404, body: { code: 'UNKNOWN_BILLING_REF' } });

    const refused = await asBilling('PUT', `/internal/entitlements/${billingRef}`, { plan: 'free', version: 9 }, 'wrong');
    expect(refused.status).toBe(404);
    expect(refused.body?.code).not.toBe('UNKNOWN_BILLING_REF');
  });

  it('delivers billing notifications once, lists them, and marks them read', async () => {
    const notification = {
      billing_ref: billingRef,
      kind: 'purchase_succeeded',
      params: { plan: 'premium_1' },
      dedupe_key: `purchase:${billingRef}`,
    };
    expect((await asBilling('POST', '/internal/notifications', notification)).status).toBe(204);
    expect((await asBilling('POST', '/internal/notifications', notification)).status).toBe(204);
    expect((await asBilling('POST', '/internal/notifications', { ...notification, kind: 'lottery_won' })).status).toBe(400);

    const page = await listNotifications(ctx);
    expect(page.unreadCount).toBe(1);
    expect(page.notifications).toHaveLength(1);
    expect(page.notifications[0]).toMatchObject({ kind: 'purchase_succeeded', params: { plan: 'premium_1' } });

    await markNotificationsRead(ctx, [page.notifications[0].id]);
    expect(await unreadNotificationCount(ctx)).toBe(0);
    expect((await listNotifications(ctx)).notifications[0].read_at).toBeDefined();
  });

  it('keeps one account’s notifications from another', async () => {
    const other = await signUp();
    expect((await listNotifications(other)).notifications).toEqual([]);
  });
});

async function ticketRef(ctx: AuthedContext): Promise<string> {
  const response = await request<{ ticket: string }>({ method: 'POST', path: '/billing/ticket', token: requireToken(ctx) });
  return ticketSubject(response.data.ticket);
}

async function runClock(): Promise<{ settled: number }> {
  const response = await fetch(`${getBaseUrl()}/internal/entitlements/expire?limit=1000`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RECONCILE_TOKEN}` },
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { data: { settled: number } }).data;
}

describe('the downgrade clock, against a live API', () => {
  it('moves a lapsed plan into grace with the free quota, and a renewal restores it', async () => {
    const ctx = await signUp();
    const ref = await ticketRef(ctx);

    const lapsesAt = new Date(Date.now() + 2000).toISOString();
    expect((await asBilling('PUT', `/internal/entitlements/${ref}`, {
      plan: 'premium_1', paid_until: lapsesAt, renews: false, version: 1,
    })).status).toBe(204);
    expect((await getMe(ctx)).plan.state).toBe('active');

    await new Promise((resolve) => setTimeout(resolve, 2500));
    await runClock();

    const lapsed = await getMe(ctx);
    expect(lapsed.plan).toMatchObject({
      code: 'premium_1',
      state: 'grace',
      storage_quota_bytes: 524_288_000,
      retention_days: 14,
      features: [],
    });
    const graceEnds = Date.parse(lapsed.plan.grace_ends_at!);
    expect(graceEnds - Date.now()).toBeGreaterThan(13.9 * 24 * 3600 * 1000);
    expect(graceEnds - Date.now()).toBeLessThan(14.1 * 24 * 3600 * 1000);

    const notices = (await listNotifications(ctx)).notifications;
    const grace = notices.filter((notice) => notice.kind === 'grace_started');
    expect(grace).toHaveLength(1);
    expect(grace[0].params).toMatchObject({ plan: 'premium_1', reason: 'ended' });
    expect(notices.every((notice) => notice.kind === 'grace_started' || notice.kind === 'expiring')).toBe(true);

    await runClock();
    expect((await listNotifications(ctx)).notifications).toHaveLength(notices.length);

    const renewed = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    expect((await asBilling('PUT', `/internal/entitlements/${ref}`, {
      plan: 'premium_1', paid_until: renewed, renews: true, version: 2,
    })).status).toBe(204);

    const restored = await getMe(ctx);
    expect(restored.plan).toMatchObject({
      state: 'active',
      storage_quota_bytes: 100_000_000_000,
      retention_days: 30,
      features: ['inbox'],
    });
    expect(restored.plan.grace_ends_at).toBeUndefined();
  });

  it('puts a refunded account into grace at once', async () => {
    const ctx = await signUp();
    const ref = await ticketRef(ctx);

    const paid = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    await asBilling('PUT', `/internal/entitlements/${ref}`, { plan: 'premium_2', paid_until: paid, renews: true, version: 1 });
    expect((await asBilling('PUT', `/internal/entitlements/${ref}`, { plan: 'free', renews: false, version: 2 })).status).toBe(204);

    const account = await getMe(ctx);
    expect(account.plan).toMatchObject({ code: 'free', state: 'grace', storage_quota_bytes: 524_288_000 });
    const notices = (await listNotifications(ctx)).notifications;
    expect(notices[0]).toMatchObject({ kind: 'grace_started', params: { plan: 'premium_2' } });
  });
});
