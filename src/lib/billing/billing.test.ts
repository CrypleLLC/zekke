import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenStore } from '@/lib/api';
import {
  BillingError,
  checkoutState,
  invoiceQr,
  lightningUri,
  listPrices,
  portalUrl,
  requote,
  startCheckout,
  Tickets,
} from './index';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function stub(...answers: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  let index = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method as string,
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      });
      const answer = answers[Math.min(index++, answers.length - 1)];
      const text = answer.body === undefined ? '' : JSON.stringify(answer.body);
      return {
        status: answer.status,
        ok: answer.status >= 200 && answer.status < 300,
        text: async () => text,
        headers: { get: () => null },
      } as unknown as Response;
    }),
  );
  return calls;
}

function tickets(clock = { now: Date.parse('2026-10-03T12:00:00Z') }) {
  const tokens = new TokenStore();
  tokens.set('jwt-token');
  return { tickets: new Tickets({ tokens }, () => clock.now), clock };
}

const ticketAnswer = (ticket: string) => ({
  status: 201,
  body: { data: { ticket, expires_at: '2026-10-03T12:10:00Z' } },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Tickets', () => {
  it('asks the API once and reuses the ticket until a minute before it expires', async () => {
    const calls = stub(ticketAnswer('t1'), ticketAnswer('t2'));
    const { tickets: source, clock } = tickets();

    expect(await source.get()).toBe('t1');
    expect(await source.get()).toBe('t1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/billing/ticket');
    expect(calls[0].headers.Authorization).toBe('Bearer jwt-token');

    clock.now = Date.parse('2026-10-03T12:09:30Z');
    expect(await source.get()).toBe('t2');
  });
});

describe('the billing service', () => {
  it('lists prices without a ticket', async () => {
    const calls = stub({ status: 200, body: [{ id: 'p1', plan: 'premium_1', period: 'year', amount_minor: 3990, currency: 'USD', providers: ['strike'] }] });

    const prices = await listPrices();

    expect(prices[0].id).toBe('p1');
    expect(calls[0].url).toBe('http://localhost:8070/prices');
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it('starts a checkout, polls it, re-quotes and opens the portal with the ticket', async () => {
    const calls = stub(
      ticketAnswer('t1'),
      { status: 201, body: { checkout_id: 'c1', provider: 'strike', quote: { ln_invoice: 'lnbc1', expires_at: 'x', btc_amount: '0.0003', sats: 30000, usd_amount_minor: 3990 } } },
      { status: 200, body: { checkout_id: 'c1', provider: 'strike', status: 'completed' } },
      { status: 200, body: { ln_invoice: 'lnbc2', expires_at: 'y', btc_amount: '0.0003', sats: 30001, usd_amount_minor: 3990 } },
      { status: 200, body: { url: 'https://portal.example/s' } },
    );
    const { tickets: source } = tickets();

    const checkout = await startCheckout(source, 'p1', 'strike');
    expect(checkout.quote?.sats).toBe(30000);
    expect(calls[1]).toMatchObject({ method: 'POST', url: 'http://localhost:8070/checkout', body: { price_id: 'p1', provider: 'strike' } });
    expect(calls[1].headers.Authorization).toBe('Bearer t1');

    expect(await checkoutState(source, 'c1')).toBe('completed');
    expect((await requote(source, 'c1')).ln_invoice).toBe('lnbc2');
    expect(await portalUrl(source)).toBe('https://portal.example/s');
    expect(calls.filter((call) => call.url.endsWith('/billing/ticket'))).toHaveLength(1);
  });

  it('turns a refusal into a BillingError carrying its code', async () => {
    stub(ticketAnswer('t1'), { status: 409, body: { code: 'SUBSCRIPTION_RENEWS' } });
    const { tickets: source } = tickets();

    const error = await startCheckout(source, 'p1', 'stripe').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BillingError);
    expect((error as BillingError).code).toBe('SUBSCRIPTION_RENEWS');
    expect((error as BillingError).status).toBe(409);
  });

  it('names an unreadable failure', async () => {
    stub({ status: 502 });

    const error = await listPrices().catch((caught: unknown) => caught);
    expect((error as BillingError).code).toBe('BILLING_UNAVAILABLE');
  });
});

describe('the Lightning invoice', () => {
  it('is a lightning: link and a QR code that draws something', () => {
    expect(lightningUri('lnbc1abc')).toBe('lightning:lnbc1abc');
    const qr = invoiceQr('lnbc1' + 'q'.repeat(300));
    expect(qr.size).toBeGreaterThan(40);
    expect(qr.path.length).toBeGreaterThan(100);
  });
});
