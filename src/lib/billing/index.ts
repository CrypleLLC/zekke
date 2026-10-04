import { request } from '@/lib/api';
import { requireToken, type TokenContext } from '@/lib/context';
import { qrModulePath, qrModules } from '@/lib/qr';
import { getBillingUrl } from './url';

export { DEFAULT_BILLING_URL, getBillingUrl } from './url';

export const TICKET_MARGIN_MS = 60_000;

export type BillingProvider = 'stripe' | 'strike';
export type BillingPeriod = 'month' | 'year';

export interface PriceRecord {
  id: string;
  plan: string;
  period: BillingPeriod;
  amount_minor: number;
  currency: string;
  providers: BillingProvider[];
}

export interface QuoteRecord {
  ln_invoice: string;
  onchain_address?: string;
  expires_at: string;
  btc_amount: string;
  sats: number;
  usd_amount_minor: number;
}

export interface CheckoutRecord {
  checkout_id: string;
  provider: BillingProvider;
  url?: string;
  quote?: QuoteRecord;
}

export type CheckoutState = 'open' | 'completed' | 'expired';

export class BillingError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(`${code} (${status}) from billing`);
    this.name = 'BillingError';
    this.code = code;
    this.status = status;
  }
}

export class Tickets {
  private current?: { ticket: string; expiresAt: number };

  constructor(
    private readonly context: TokenContext,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<string> {
    if (this.current !== undefined && this.current.expiresAt - TICKET_MARGIN_MS > this.now()) {
      return this.current.ticket;
    }
    const response = await request<{ ticket: string; expires_at: string }>({
      method: 'POST',
      path: '/billing/ticket',
      token: requireToken(this.context),
      timeoutMs: this.context.timeoutMs,
    });
    this.current = { ticket: response.data.ticket, expiresAt: Date.parse(response.data.expires_at) };
    return this.current.ticket;
  }
}

async function billing<T>(method: 'GET' | 'POST', path: string, ticket?: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (ticket !== undefined) {
    headers.Authorization = `Bearer ${ticket}`;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${getBillingUrl()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    const code =
      typeof parsed === 'object' && parsed !== null && typeof (parsed as { code?: unknown }).code === 'string'
        ? (parsed as { code: string }).code
        : 'BILLING_UNAVAILABLE';
    throw new BillingError(code, response.status);
  }

  return parsed as T;
}

export async function listPrices(): Promise<PriceRecord[]> {
  return (await billing<PriceRecord[] | undefined>('GET', '/prices')) ?? [];
}

export async function startCheckout(
  tickets: Tickets,
  priceId: string,
  provider: BillingProvider,
): Promise<CheckoutRecord> {
  return billing<CheckoutRecord>('POST', '/checkout', await tickets.get(), { price_id: priceId, provider });
}

export async function checkoutState(tickets: Tickets, checkoutId: string): Promise<CheckoutState> {
  const status = await billing<{ status: CheckoutState }>('GET', `/checkout/${encodeURIComponent(checkoutId)}`, await tickets.get());
  return status.status;
}

export async function requote(tickets: Tickets, checkoutId: string): Promise<QuoteRecord> {
  return billing<QuoteRecord>('POST', `/checkout/${encodeURIComponent(checkoutId)}/quote`, await tickets.get());
}

export async function portalUrl(tickets: Tickets): Promise<string> {
  return (await billing<{ url: string }>('POST', '/portal', await tickets.get())).url;
}

export function lightningUri(invoice: string): string {
  return `lightning:${invoice}`;
}

export function invoiceQr(invoice: string): { size: number; path: string } {
  const modules = qrModules(lightningUri(invoice).toUpperCase(), 'L', 2);
  return { size: modules.length, path: qrModulePath(modules) };
}
