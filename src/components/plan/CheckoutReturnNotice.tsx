'use client';

import { useEffect, useRef, useState } from 'react';
import { checkoutReturn, PLAN_COPY, planChanged, planName, withoutCheckoutParams } from '@/lib/app';
import type { PlanRecord } from '@/lib/users';
import { useZekke } from '@/components/session/ZekkeProvider';
import { Notice } from '@/components/ui';

const POLL_MS = 3000;
const GIVE_UP_MS = 2 * 60 * 1000;
const SETTLED_AFTER_MS = 6000;

type Phase = 'idle' | 'confirming' | 'confirmed' | 'late' | 'cancelled';

export default function CheckoutReturnNotice() {
  const { account, refreshAccount } = useZekke();
  const [phase, setPhase] = useState<Phase>('idle');
  const started = useRef<{ at: number; plan: PlanRecord | undefined }>(undefined);

  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) {
      return;
    }
    handled.current = true;
    const outcome = checkoutReturn(window.location.search);
    if (outcome === undefined) {
      return;
    }
    window.history.replaceState(null, '', withoutCheckoutParams(window.location.href));
    if (outcome === 'portal') {
      void refreshAccount();
      return;
    }
    if (outcome === 'cancelled') {
      setPhase('cancelled');
      return;
    }
    started.current = { at: Date.now(), plan: account?.plan };
    setPhase('confirming');
  }, [account?.plan, refreshAccount]);

  useEffect(() => {
    if (phase !== 'confirming') {
      return;
    }
    const timer = window.setInterval(() => {
      if (Date.now() - (started.current?.at ?? 0) > GIVE_UP_MS) {
        setPhase('late');
        return;
      }
      void refreshAccount();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [phase, refreshAccount]);

  useEffect(() => {
    if (phase !== 'confirming' || account?.plan === undefined) {
      return;
    }
    const before = started.current?.plan;
    if (before === undefined) {
      started.current = { at: started.current?.at ?? Date.now(), plan: account.plan };
      return;
    }
    const settled =
      account.plan.state === 'active' &&
      account.plan.code !== 'free' &&
      Date.now() - (started.current?.at ?? 0) > SETTLED_AFTER_MS;
    if (planChanged(before, account.plan) || settled) {
      setPhase('confirmed');
    }
  }, [phase, account]);

  switch (phase) {
    case 'confirming':
      return <Notice tone="info">{PLAN_COPY.confirming}</Notice>;
    case 'confirmed':
      return (
        <Notice tone="success" onDismiss={() => setPhase('idle')}>
          {PLAN_COPY.confirmed(planName(account?.plan.code))}
        </Notice>
      );
    case 'late':
      return (
        <Notice tone="warning" onDismiss={() => setPhase('idle')}>
          {PLAN_COPY.notConfirmed}
        </Notice>
      );
    case 'cancelled':
      return (
        <Notice tone="info" onDismiss={() => setPhase('idle')}>
          {PLAN_COPY.cancelled}
        </Notice>
      );
    default:
      return null;
  }
}
