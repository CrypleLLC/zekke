import { describe, expect, it } from 'vitest';
import { BillingError, type PriceRecord } from '@/lib/billing';
import type { PlanRecord } from '@/lib/users';
import {
  billingMessage,
  checkoutReturn,
  daysUntil,
  formatUsd,
  graceView,
  planChanged,
  planOffers,
  planSummary,
  priceLabel,
  quoteCountdown,
  satsLabel,
  withoutCheckoutParams,
} from './plan';

const now = new Date('2026-10-03T12:00:00Z');

function plan(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    code: 'free',
    state: 'free',
    renews: false,
    storage_quota_bytes: 524_288_000,
    retention_days: 0,
    features: [],
    ...overrides,
  };
}

function price(id: string, planCode: string, period: 'month' | 'year', amount: number): PriceRecord {
  return { id, plan: planCode, period, amount_minor: amount, currency: 'USD', providers: ['stripe', 'strike'] };
}

describe('prices', () => {
  it('formats dollars and periods', () => {
    expect(formatUsd(399)).toBe('$3.99');
    expect(priceLabel({ amount_minor: 3990, period: 'year' })).toBe('$39.90 a year');
  });

  it('groups prices by plan, monthly first, in plan order', () => {
    const offers = planOffers([
      price('p2y', 'premium_2', 'year', 19990),
      price('p1y', 'premium_1', 'year', 3990),
      price('p1m', 'premium_1', 'month', 399),
      price('x', 'enterprise', 'year', 1),
    ]);
    expect(offers.map((offer) => offer.plan)).toEqual(['premium_1', 'premium_2']);
    expect(offers[0].prices.map((entry) => entry.id)).toEqual(['p1m', 'p1y']);
    expect(offers[0].name).toBe('Premium 1');
    expect(offers[1].storage).toBe('1 TB');
  });
});

describe('the plan summary', () => {
  it('describes each state', () => {
    expect(planSummary(plan())).toBe('Free');
    expect(planSummary(plan({ code: 'premium_1', state: 'active', renews: true, paid_until: '2027-10-04T00:00:00Z' })))
      .toMatch(/^Premium 1 · renews on .*2027/);
    expect(planSummary(plan({ code: 'premium_2', state: 'active', paid_until: '2027-10-04T00:00:00Z' })))
      .toMatch(/^Premium 2 · paid until /);
    expect(planSummary(plan({ code: 'premium_1', state: 'grace', grace_ends_at: '2026-10-17T12:00:00Z' })))
      .toMatch(/^Premium 1 has ended · files kept as they are until /);
  });
});

describe('graceView', () => {
  const grace = plan({ code: 'premium_1', state: 'grace', grace_ends_at: '2026-10-08T12:00:00Z', paid_until: '2026-09-30T00:00:00Z' });

  it('is nothing outside grace', () => {
    expect(graceView(plan(), 0, now)).toBeUndefined();
  });

  it('counts the days and the bytes over the free plan', () => {
    const view = graceView(grace, 524_288_000 + 3 * 1024 ** 3, now)!;
    expect(view.title).toBe('Your plan has ended');
    expect(view.body).toContain('3.0 GiB more than the free plan allows');
    expect(view.body).toContain('In 5 days');
  });

  it('says nothing will be deleted when the drive fits', () => {
    expect(graceView(grace, 1000, now)!.body).toContain('Nothing will be deleted');
  });

  it('names the smaller plan when that is the target', () => {
    const smaller = plan({ code: 'premium_1', state: 'grace', grace_ends_at: '2026-10-04T06:00:00Z', paid_until: '2027-01-01T00:00:00Z', storage_quota_bytes: 100e9 });
    const view = graceView(smaller, 150e9, now)!;
    expect(view.title).toBe('Your Drive is larger than Premium 1 allows');
    expect(view.body).toContain('Within a day');
  });
});

describe('helpers', () => {
  it('counts down a quote', () => {
    expect(quoteCountdown('2026-10-03T12:04:05Z', now)).toBe('4:05');
    expect(quoteCountdown('2026-10-03T11:59:00Z', now)).toBeUndefined();
    expect(quoteCountdown('garbage', now)).toBeUndefined();
  });

  it('writes sats and days', () => {
    expect(satsLabel(1234567)).toBe('1,234,567 sats');
    expect(daysUntil('2026-10-05T11:00:00Z', now)).toBe(2);
    expect(daysUntil(undefined, now)).toBeUndefined();
  });

  it('notices a plan change', () => {
    expect(planChanged(plan(), plan({ code: 'premium_1', state: 'active' }))).toBe(true);
    expect(planChanged(plan(), plan())).toBe(false);
    expect(planChanged(undefined, plan())).toBe(false);
  });

  it('reads and strips the checkout return', () => {
    expect(checkoutReturn('?checkout=done')).toBe('done');
    expect(checkoutReturn('?checkout=cancelled&x=1')).toBe('cancelled');
    expect(checkoutReturn('?portal=done')).toBe('portal');
    expect(checkoutReturn('?checkout=other')).toBeUndefined();
    expect(withoutCheckoutParams('http://localhost:3000/?checkout=done&tab=1#top')).toBe('/?tab=1#top');
  });

  it('words billing refusals and leaves other errors to the caller', () => {
    expect(billingMessage(new BillingError('NO_CUSTOMER', 409), () => 'x')).toBe('There is no card subscription on this account.');
    expect(billingMessage(new BillingError('SOMETHING_NEW', 500), () => 'x')).toContain('could not be loaded');
    expect(billingMessage(new Error('boom'), () => 'fallback')).toBe('fallback');
  });
});
