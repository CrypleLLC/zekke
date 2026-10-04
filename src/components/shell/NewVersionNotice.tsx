'use client';

import { useCallback, useEffect, useState } from 'react';
import { BUILD_COPY, BUILD_ID_PATH, deployedBuildId, isNewerDeployment, runningBuildId } from '@/lib/app';
import { Button, Notice } from '@/components/ui';

const CHECK_MS = 30 * 60 * 1000;

export default function NewVersionNotice() {
  const [stale, setStale] = useState(false);

  const check = useCallback(async () => {
    try {
      const response = await fetch(BUILD_ID_PATH, { cache: 'no-store' });
      if (!response.ok) {
        return;
      }
      if (isNewerDeployment(runningBuildId(), deployedBuildId(await response.json()))) {
        setStale(true);
      }
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => void check(), CHECK_MS);
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [check]);

  if (!stale) {
    return null;
  }

  return (
    <Notice tone="info">
      <span className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <strong>{BUILD_COPY.title}</strong> {BUILD_COPY.body}
        </span>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          {BUILD_COPY.reload}
        </Button>
      </span>
    </Notice>
  );
}
