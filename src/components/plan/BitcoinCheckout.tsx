'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  checkoutState,
  invoiceQr,
  lightningUri,
  requote,
  type CheckoutRecord,
  type CheckoutState,
  type QuoteRecord,
  type Tickets,
} from '@/lib/billing';
import { billingMessage, formatUsd, PLAN_COPY, quoteCountdown, satsLabel } from '@/lib/app';
import { useZekke } from '@/components/session/ZekkeProvider';
import { Button, CopyButton, Notice } from '@/components/ui';

const POLL_MS = 4000;

export default function BitcoinCheckout({
  checkout,
  tickets,
  onPaid,
  onClose,
  appliedPlan,
}: {
  checkout: CheckoutRecord & { quote: QuoteRecord };
  tickets: Tickets;
  onPaid: () => void;
  onClose: () => void;
  appliedPlan?: string;
}) {
  const { reportError } = useZekke();
  const [quote, setQuote] = useState<QuoteRecord>(checkout.quote);
  const [state, setState] = useState<CheckoutState>('open');
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const qr = useMemo(() => invoiceQr(quote.ln_invoice), [quote.ln_invoice]);
  const countdown = quoteCountdown(quote.expires_at, now);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (state !== 'open') {
      return;
    }
    const timer = window.setInterval(() => {
      void checkoutState(tickets, checkout.checkout_id)
        .then((next) => {
          setState(next);
          if (next === 'completed') {
            onPaid();
          }
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [state, tickets, checkout.checkout_id, onPaid]);

  const renew = useCallback(async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      setQuote(await requote(tickets, checkout.checkout_id));
    } catch (error) {
      setMessage(billingMessage(error, reportError));
    } finally {
      setBusy(false);
    }
  }, [tickets, checkout.checkout_id, reportError]);

  if (state === 'completed') {
    return (
      <div className="space-y-4">
        <Notice tone={appliedPlan === undefined ? 'info' : 'success'}>
          {appliedPlan === undefined ? PLAN_COPY.applying : PLAN_COPY.applied(appliedPlan)}
        </Notice>
        <Button onClick={onClose}>{PLAN_COPY.close}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-title text-ink">{PLAN_COPY.bitcoinTitle}</h3>
        <p className="mt-1 text-compact text-ink-muted">{PLAN_COPY.bitcoinHint}</p>
      </div>
      {message ? (
        <Notice tone="danger" onDismiss={() => setMessage(undefined)}>
          {message}
        </Notice>
      ) : null}

      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <svg
          role="img"
          aria-label={PLAN_COPY.bitcoinTitle}
          viewBox={`0 0 ${qr.size} ${qr.size}`}
          shapeRendering="crispEdges"
          className={`h-56 w-56 shrink-0 rounded-lg bg-white p-1 text-black ${countdown === undefined ? 'opacity-30' : ''}`}
        >
          <path d={qr.path} fill="currentColor" />
        </svg>
        <div className="min-w-0 space-y-2">
          <p className="text-headline text-ink">{satsLabel(quote.sats)}</p>
          <p className="text-compact text-ink-muted">
            {quote.btc_amount} BTC · {formatUsd(quote.usd_amount_minor)}
          </p>
          <p className={`text-compact ${countdown === undefined ? 'text-danger' : 'text-ink-muted'}`}>
            {countdown === undefined ? PLAN_COPY.expired : PLAN_COPY.expiresIn(countdown)}
          </p>
          {countdown === undefined ? (
            <Button disabled={busy} onClick={() => void renew()}>
              {PLAN_COPY.newQuote}
            </Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <a
                href={lightningUri(quote.ln_invoice)}
                className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-compact font-semibold text-white shadow-card hover:bg-brand-700"
              >
                {PLAN_COPY.openWallet}
              </a>
              <CopyButton value={quote.ln_invoice} label={PLAN_COPY.copyInvoice} />
            </div>
          )}
          {quote.onchain_address !== undefined && countdown !== undefined ? (
            <div className="pt-2">
              <p className="text-caption normal-case tracking-normal text-ink-muted">{PLAN_COPY.onchain}</p>
              <div className="flex items-center gap-2">
                <code className="truncate text-compact text-ink">{quote.onchain_address}</code>
                <CopyButton value={quote.onchain_address} iconOnly />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <p className="text-compact text-ink-muted">{PLAN_COPY.waiting}</p>
      <Button variant="secondary" onClick={onClose}>
        {PLAN_COPY.close}
      </Button>
    </div>
  );
}
