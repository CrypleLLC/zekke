export const DEFAULT_BILLING_URL = 'http://localhost:8070';

export function getBillingUrl(): string {
  const configured = process.env.NEXT_PUBLIC_BILLING_URL?.trim();
  return (configured && configured.length > 0 ? configured : DEFAULT_BILLING_URL).replace(/\/+$/, '');
}
