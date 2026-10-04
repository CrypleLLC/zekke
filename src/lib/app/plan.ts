import { BillingError, type BillingProvider, type PriceRecord } from '@/lib/billing';
import type { PlanRecord } from '@/lib/users';
import { notificationDate, planName } from './notifications';
import { formatBytes } from './vault';

const DAY_MS = 24 * 60 * 60 * 1000;

const PLAN_ORDER = ['premium_1', 'premium_2'] as const;

const PLAN_STORAGE: Record<string, string> = {
  free: '500 MB',
  premium_1: '100 GB',
  premium_2: '1 TB',
};

export const PLAN_COPY = {
  tab: 'Plan',
  title: 'Your plan',
  plansTitle: 'Plans',
  storage: (used: string, quota: string) => `${used} of ${quota} used`,
  trashKept: (days: number) => (days === 0 ? 'Deleted items are not kept.' : `Deleted items are kept for ${days} days.`),
  payCard: 'Pay by card',
  payBitcoin: 'Pay with Bitcoin',
  includes: (storage: string) => `${storage} of Drive storage, the Trash for 30 days, and every premium feature.`,
  dataLoss:
    'If a paid plan ends — a renewal fails, a Bitcoin period runs out, or a payment is refunded — your files stay ' +
    'readable for 14 days and you are warned every day. After that, the most recent uploads are deleted until your ' +
    'Drive fits the free plan. Documents, notes, secrets and passwords are never deleted.',
  cardIdentity: 'Paying by card identifies you to Zekke and to Stripe. Paying with Bitcoin does not.',
  renewsNote: 'Your card subscription renews on its own. Change or cancel it from Manage subscription.',
  manage: 'Manage subscription',
  opening: 'Opening…',
  loading: 'Loading plans…',
  unavailable: 'Plans could not be loaded. Try again in a moment.',
  noPrices: 'No plan is on sale right now.',
  seePlans: 'See plans',
  confirming: 'Confirming your payment…',
  confirmed: (plan: string) => `${plan} is active. Thank you.`,
  notConfirmed:
    'Your payment has not reached your account yet. It can take a few minutes; your plan updates on its own.',
  cancelled: 'The payment was cancelled. Nothing was charged.',
  bitcoinTitle: 'Pay with Bitcoin',
  bitcoinHint: 'Scan with a Lightning wallet, or copy the invoice. The amount is fixed until the quote expires.',
  openWallet: 'Open in wallet',
  copyInvoice: 'Copy invoice',
  copied: 'Copied',
  onchain: 'On-chain address',
  expiresIn: (countdown: string) => `This quote expires in ${countdown}.`,
  expired: 'This quote expired. Get a new one to pay.',
  newQuote: 'Get a new quote',
  waiting: 'Waiting for the payment…',
  paid: 'Payment received.',
  applying: 'Payment received. Updating your plan…',
  applied: (plan: string) => `Payment received. ${plan} is active.`,
  close: 'Close',
  deleteRenews:
    'Your card subscription still renews. Cancel it from Manage subscription before deleting the account. If you ' +
    'delete it anyway, the subscription is cancelled and any charge made after the deletion is refunded.',
} as const;

const BILLING_MESSAGES: Record<string, string> = {
  SUBSCRIPTION_RENEWS: 'Your card subscription renews. Change plans from Manage subscription.',
  NO_CUSTOMER: 'There is no card subscription on this account.',
  PROVIDER_DISABLED: 'This way of paying is not available right now.',
  PROVIDER_FAILED: 'The payment provider did not answer. Try again in a moment.',
  NOT_OFFERED: 'That plan is not sold this way.',
  UNKNOWN_PRICE: 'That price is no longer on sale. Reload the plans.',
  CHECKOUT_CLOSED: 'That payment is already closed.',
  INVALID_TICKET: 'Your session to the payment service expired. Try again.',
};

export function billingMessage(error: unknown, fallback: (error: unknown) => string): string {
  if (error instanceof BillingError) {
    return BILLING_MESSAGES[error.code] ?? PLAN_COPY.unavailable;
  }
  return fallback(error);
}

export function formatUsd(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

export function priceLabel(price: Pick<PriceRecord, 'amount_minor' | 'period'>): string {
  return `${formatUsd(price.amount_minor)} a ${price.period}`;
}

export function planStorage(code: string): string {
  return PLAN_STORAGE[code] ?? '';
}

export interface PlanOffer {
  plan: string;
  name: string;
  storage: string;
  prices: PriceRecord[];
}

export function planOffers(prices: readonly PriceRecord[]): PlanOffer[] {
  return PLAN_ORDER.map((plan) => ({
    plan,
    name: planName(plan),
    storage: planStorage(plan),
    prices: prices
      .filter((price) => price.plan === plan)
      .sort((a, b) => (a.period === b.period ? a.amount_minor - b.amount_minor : a.period === 'month' ? -1 : 1)),
  })).filter((offer) => offer.prices.length > 0);
}

export function offersProvider(price: Pick<PriceRecord, 'providers'>, provider: BillingProvider): boolean {
  return price.providers.includes(provider);
}

export function planSummary(plan: PlanRecord): string {
  const name = planName(plan.code);
  const until = notificationDate(plan.paid_until);

  if (plan.state === 'grace') {
    const ends = notificationDate(plan.grace_ends_at);
    return ends === undefined ? `${name} has ended` : `${name} has ended · files kept as they are until ${ends}`;
  }
  if (plan.state === 'free' || plan.code === 'free') {
    return 'Free';
  }
  if (until === undefined) {
    return name;
  }
  return plan.renews ? `${name} · renews on ${until}` : `${name} · paid until ${until}`;
}

export function daysUntil(at: string | undefined, now: Date = new Date()): number | undefined {
  if (at === undefined) {
    return undefined;
  }
  const moment = Date.parse(at);
  return Number.isNaN(moment) ? undefined : Math.max(0, Math.ceil((moment - now.getTime()) / DAY_MS));
}

export interface GraceView {
  title: string;
  body: string;
}

export function graceView(plan: PlanRecord, usedBytes: number | undefined, now: Date = new Date()): GraceView | undefined {
  if (plan.state !== 'grace') {
    return undefined;
  }

  const left = daysUntil(plan.grace_ends_at, now);
  const when = left === undefined ? 'soon' : left <= 1 ? 'within a day' : `in ${left} days`;
  const paid = plan.code !== 'free' && plan.paid_until !== undefined && Date.parse(plan.paid_until) > now.getTime();
  const target = paid ? planName(plan.code) : 'the free plan';
  const over = usedBytes === undefined ? undefined : usedBytes - plan.storage_quota_bytes;

  if (over !== undefined && over <= 0) {
    return {
      title: paid ? `Your Drive fits ${target}` : 'Your plan has ended',
      body: 'Nothing will be deleted: your Drive already fits. Renew to get your storage and features back.',
    };
  }

  return {
    title: paid ? `Your Drive is larger than ${target} allows` : 'Your plan has ended',
    body:
      (over === undefined
        ? `Your Drive holds more than ${target} allows.`
        : `Your Drive holds ${formatBytes(over)} more than ${target} allows.`) +
      ` ${when[0].toUpperCase()}${when.slice(1)}, the most recent uploads are deleted until it fits. ` +
      'Renew, or download and delete files yourself before then.',
  };
}

export function quoteCountdown(expiresAt: string, now: Date = new Date()): string | undefined {
  const left = Date.parse(expiresAt) - now.getTime();
  if (Number.isNaN(left) || left <= 0) {
    return undefined;
  }
  const seconds = Math.ceil(left / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function satsLabel(sats: number): string {
  return `${sats.toLocaleString('en-US')} sats`;
}

export function planChanged(before: PlanRecord | undefined, after: PlanRecord | undefined): boolean {
  if (before === undefined || after === undefined) {
    return false;
  }
  return before.code !== after.code || before.state !== after.state || before.paid_until !== after.paid_until;
}

export type CheckoutReturn = 'done' | 'cancelled' | 'portal';

export function checkoutReturn(search: string): CheckoutReturn | undefined {
  const params = new URLSearchParams(search);
  if (params.get('portal') === 'done') {
    return 'portal';
  }
  const checkout = params.get('checkout');
  return checkout === 'done' || checkout === 'cancelled' ? checkout : undefined;
}

export function withoutCheckoutParams(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('checkout');
  url.searchParams.delete('portal');
  return `${url.pathname}${url.search}${url.hash}`;
}
