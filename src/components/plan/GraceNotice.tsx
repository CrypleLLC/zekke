'use client';

import { useSyncExternalStore } from 'react';
import { graceView, PLAN_COPY, storageUsage, subscribeToStorageUsage } from '@/lib/app';
import { useZekke } from '@/components/session/ZekkeProvider';
import { Button, Notice } from '@/components/ui';

export default function GraceNotice({ onSeePlans }: { onSeePlans: () => void }) {
  const { account } = useZekke();
  const usage = useSyncExternalStore(subscribeToStorageUsage, storageUsage, storageUsage);
  const grace = account?.plan === undefined ? undefined : graceView(account.plan, usage?.used_bytes);

  if (grace === undefined) {
    return null;
  }

  return (
    <Notice tone="danger">
      <span className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <strong>{grace.title}.</strong> {grace.body}
        </span>
        <Button variant="secondary" onClick={onSeePlans}>
          {PLAN_COPY.seePlans}
        </Button>
      </span>
    </Notice>
  );
}
