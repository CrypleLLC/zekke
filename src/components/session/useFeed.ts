'use client';

import { useEffect, useMemo, useRef } from 'react';
import { FEED_SCOPES, feedFor, type FeedScope } from '@/lib/feed';
import { useAuthedContext, useZekke } from './ZekkeProvider';

export function useFeedPolling(): void {
  const context = useAuthedContext();
  const { holds } = useZekke();
  const scopes = useMemo(() => FEED_SCOPES.filter((scope) => holds(scope)), [holds]);

  useEffect(() => {
    const feed = feedFor(context);
    const resume = () => {
      void feed.syncAll(scopes);
      feed.startPolling(scopes);
    };

    if (document.visibilityState === 'visible') {
      resume();
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        resume();
      } else {
        feed.stopPolling();
      }
    };
    const onOnline = () => void feed.syncAll(scopes);

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);

    return () => {
      feed.stopPolling();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onOnline);
    };
  }, [context, scopes]);
}

export function useFeedChanges(scope: FeedScope, reload: () => unknown): void {
  const context = useAuthedContext();
  const latest = useRef(reload);

  useEffect(() => {
    latest.current = reload;
  }, [reload]);

  useEffect(() => feedFor(context).subscribe(scope, () => void latest.current()), [context, scope]);
}
