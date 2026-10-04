'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ApiError } from '@/lib/api';
import {
  listPrices,
  portalUrl,
  startCheckout,
  Tickets,
  type BillingProvider,
  type CheckoutRecord,
  type PriceRecord,
  type QuoteRecord,
} from '@/lib/billing';
import { getStorageUsage } from '@/lib/files';
import {
  billingMessage,
  formatBytes,
  graceView,
  offersProvider,
  PLAN_COPY,
  planChanged,
  planName,
  planOffers,
  planSummary,
  priceLabel,
  setStorageUsage,
  storageBar,
  storageUsage,
  subscribeToStorageUsage,
} from '@/lib/app';
import { useAuthedContext, useZekke } from '@/components/session/ZekkeProvider';
import { Badge, Button, Card, Notice, Spinner } from '@/components/ui';
import type { PlanRecord } from '@/lib/users';
import BitcoinCheckout from './BitcoinCheckout';

const APPLY_POLL_MS = 2000;
const APPLY_TIMEOUT_MS = 90 * 1000;

export function useBillingTickets(): Tickets {
  const context = useAuthedContext();
  return useMemo(() => new Tickets(context), [context]);
}

export function ManageSubscriptionButton({ onError }: { onError: (message: string) => void }) {
  const tickets = useBillingTickets();
  const { reportError } = useZekke();
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    try {
      window.location.assign(await portalUrl(tickets));
    } catch (error) {
      onError(billingMessage(error, reportError));
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" disabled={busy} onClick={() => void open()}>
      {busy ? PLAN_COPY.opening : PLAN_COPY.manage}
    </Button>
  );
}

export default function PlanScreen() {
  const context = useAuthedContext();
  const { account, refreshAccount, reportError, holds } = useZekke();
  const tickets = useBillingTickets();
  const usage = useSyncExternalStore(subscribeToStorageUsage, storageUsage, storageUsage);
  const [prices, setPrices] = useState<PriceRecord[]>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [bitcoin, setBitcoin] = useState<CheckoutRecord & { quote: QuoteRecord }>();
  const [awaiting, setAwaiting] = useState<{ plan: PlanRecord; since: number }>();
  const [applied, setApplied] = useState<string>();
  const [late, setLate] = useState(false);
  const plan = account?.plan;

  const paid = useCallback(() => {
    if (plan !== undefined) {
      setAwaiting({ plan, since: Date.now() });
    }
    void refreshAccount();
  }, [plan, refreshAccount]);

  useEffect(() => {
    if (awaiting === undefined) {
      return;
    }
    const timer = window.setInterval(() => {
      if (Date.now() - awaiting.since > APPLY_TIMEOUT_MS) {
        setAwaiting(undefined);
        setLate(true);
        return;
      }
      void refreshAccount();
    }, APPLY_POLL_MS);
    return () => window.clearInterval(timer);
  }, [awaiting, refreshAccount]);

  useEffect(() => {
    if (awaiting !== undefined && plan !== undefined && planChanged(awaiting.plan, plan)) {
      setAwaiting(undefined);
      setApplied(planName(plan.code));
    }
  }, [awaiting, plan]);

  useEffect(() => {
    let live = true;
    void listPrices()
      .then((loaded) => live && setPrices(loaded))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (usage !== undefined || !holds('files')) {
      return;
    }
    void getStorageUsage(context)
      .then(setStorageUsage)
      .catch((error: unknown) => {
        if (!(error instanceof ApiError)) {
          throw error;
        }
      });
  }, [context, usage, holds]);

  const buy = useCallback(
    async (price: PriceRecord, provider: BillingProvider) => {
      setBusy(`${price.id}:${provider}`);
      setMessage(undefined);
      try {
        setApplied(undefined);
        setLate(false);
        const checkout = await startCheckout(tickets, price.id, provider);
        if (checkout.url !== undefined) {
          window.location.assign(checkout.url);
          return;
        }
        if (checkout.quote !== undefined) {
          setBitcoin({ ...checkout, quote: checkout.quote });
        }
      } catch (error) {
        setMessage(billingMessage(error, reportError));
      }
      setBusy(undefined);
    },
    [tickets, reportError],
  );

  if (plan === undefined) {
    return <Spinner />;
  }

  const grace = graceView(plan, usage?.used_bytes);
  const bar = usage === undefined ? undefined : storageBar({ ...usage, quota_bytes: plan.storage_quota_bytes });
  const offers = planOffers(prices ?? []);
  const everPaid = plan.code !== 'free' || plan.state !== 'free';

  return (
    <div className="space-y-8">
      <Card
        title={PLAN_COPY.title}
        actions={everPaid ? <ManageSubscriptionButton onError={setMessage} /> : undefined}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-compact font-semibold text-ink">{planSummary(plan)}</p>
            {plan.state === 'grace' ? <Badge tone="danger">Ended</Badge> : null}
            {plan.state === 'active' ? <Badge tone="success">Active</Badge> : null}
          </div>
          {bar !== undefined && usage !== undefined ? (
            <div>
              <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-line">
                <span
                  style={{ width: `${bar.percent}%` }}
                  className={`h-full ${bar.nearlyFull ? 'bg-warning' : 'bg-brand-500'}`}
                />
              </div>
              <p className="mt-1 text-caption normal-case tracking-normal text-ink-muted">
                {PLAN_COPY.storage(formatBytes(usage.used_bytes), formatBytes(plan.storage_quota_bytes))}
              </p>
            </div>
          ) : null}
          <p className="text-compact text-ink-muted">{PLAN_COPY.trashKept(plan.retention_days)}</p>
          {grace !== undefined ? (
            <Notice tone="danger">
              <strong>{grace.title}.</strong> {grace.body}
            </Notice>
          ) : null}
          {late ? (
            <Notice tone="warning" onDismiss={() => setLate(false)}>
              {PLAN_COPY.notConfirmed}
            </Notice>
          ) : null}
        </div>
      </Card>

      <Card title={PLAN_COPY.plansTitle}>
        {bitcoin !== undefined ? (
          <BitcoinCheckout
            checkout={bitcoin}
            tickets={tickets}
            onPaid={paid}
            onClose={() => setBitcoin(undefined)}
            appliedPlan={applied}
          />
        ) : (
          <div className="space-y-4">
            {message ? (
              <Notice tone="danger" onDismiss={() => setMessage(undefined)}>
                {message}
              </Notice>
            ) : null}
            {plan.renews ? <Notice tone="info">{PLAN_COPY.renewsNote}</Notice> : null}
            {prices === undefined && !failed ? <Spinner /> : null}
            {failed ? <Notice tone="warning">{PLAN_COPY.unavailable}</Notice> : null}
            {prices !== undefined && offers.length === 0 ? <Notice tone="info">{PLAN_COPY.noPrices}</Notice> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {offers.map((offer) => (
                <div key={offer.plan} className="space-y-3 rounded-xl border border-line p-4">
                  <div>
                    <p className="text-title text-ink">{offer.name}</p>
                    <p className="mt-1 text-compact text-ink-muted">{PLAN_COPY.includes(offer.storage)}</p>
                  </div>
                  {offer.prices.map((price) => (
                    <div key={price.id} className="space-y-2 border-t border-line pt-3">
                      <p className="text-compact font-semibold text-ink">{priceLabel(price)}</p>
                      <div className="flex flex-wrap gap-2">
                        {offersProvider(price, 'stripe') ? (
                          <Button
                            disabled={busy !== undefined || plan.renews}
                            onClick={() => void buy(price, 'stripe')}
                          >
                            {PLAN_COPY.payCard}
                          </Button>
                        ) : null}
                        {offersProvider(price, 'strike') ? (
                          <Button
                            variant="secondary"
                            disabled={busy !== undefined || plan.renews}
                            onClick={() => void buy(price, 'strike')}
                          >
                            {PLAN_COPY.payBitcoin}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <Notice tone="warning">{PLAN_COPY.dataLoss}</Notice>
            <p className="text-caption normal-case tracking-normal text-ink-muted">{PLAN_COPY.cardIdentity}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
