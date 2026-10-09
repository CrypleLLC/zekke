import { getBaseUrl, request } from '@/lib/api';
import { requireToken, type AuthedContext } from '@/lib/context';

export const BILLING_TOKEN = process.env.ZEKKE_E2E_BILLING_TOKEN ?? 'local-billing-token-0123456789abcdef';

export async function asBilling(method: string, path: string, body: unknown, token = BILLING_TOKEN) {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? undefined : (JSON.parse(text) as { code?: string }) };
}

export function ticketSubject(ticket: string): string {
  const payload = ticket.split('.')[1];
  return (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub: string }).sub;
}

export async function billingRefOf(ctx: AuthedContext): Promise<string> {
  const response = await request<{ ticket: string }>({ method: 'POST', path: '/billing/ticket', token: requireToken(ctx) });
  return ticketSubject(response.data.ticket);
}

export async function grantPlan(ctx: AuthedContext, plan: string): Promise<void> {
  const paidUntil = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  const pushed = await asBilling('PUT', `/internal/entitlements/${await billingRefOf(ctx)}`, {
    plan,
    paid_until: paidUntil,
    renews: true,
    version: 1,
  });
  if (pushed.status !== 204) {
    throw new Error(`granting ${plan} answered ${pushed.status} ${pushed.body?.code ?? ''}`);
  }
}
