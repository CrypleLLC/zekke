'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listNotifications,
  markNotificationsRead,
  unreadNotificationCount,
  type NotificationRecord,
} from '@/lib/notifications';
import { NOTIFICATIONS_COPY, notificationView, unreadIds, type NotificationTone } from '@/lib/app';
import { useAuthedContext, useZekke } from '@/components/session/ZekkeProvider';
import { BellIcon } from '@/components/ui/icons';
import { Spinner } from '@/components/ui';

const POLL_MS = 5 * 60 * 1000;

const TONE_DOT: Record<NotificationTone, string> = {
  info: 'bg-brand-500',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export default function NotificationBell() {
  const context = useAuthedContext();
  const { refreshAccount } = useZekke();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [records, setRecords] = useState<NotificationRecord[]>();
  const [cursor, setCursor] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const known = useRef<number>(undefined);

  const poll = useCallback(async () => {
    try {
      const count = await unreadNotificationCount(context);
      if (known.current !== undefined && count > known.current) {
        void refreshAccount();
      }
      known.current = count;
      setUnread(count);
    } catch {
      return;
    }
  }, [context, refreshAccount]);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    const onFocus = () => void poll();
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [poll]);

  const markShown = useCallback(
    async (shown: NotificationRecord[]) => {
      const ids = unreadIds(shown);
      if (ids.length === 0) {
        return;
      }
      try {
        await markNotificationsRead(context, ids);
        setUnread((current) => {
          const next = Math.max(0, current - ids.length);
          known.current = next;
          return next;
        });
      } catch {
        return;
      }
    },
    [context],
  );

  const load = useCallback(
    async (from?: string) => {
      setLoading(true);
      setFailed(false);
      try {
        const page = await listNotifications(context, { cursor: from });
        setRecords((current) => (from === undefined ? page.notifications : [...(current ?? []), ...page.notifications]));
        setCursor(page.nextCursor);
        if (from === undefined) {
          known.current = page.unreadCount;
          setUnread(page.unreadCount);
        }
        void markShown(page.notifications);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [context, markShown],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    void load();

    function onPointerDown(event: MouseEvent) {
      if (!holder.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, load]);

  const now = new Date();

  return (
    <div ref={holder} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={NOTIFICATIONS_COPY.unreadLabel(unread)}
        onClick={() => setOpen((current) => !current)}
        className="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
      >
        <BellIcon className="h-5 w-5 shrink-0" />
        {unread > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.625rem] font-semibold leading-none text-white">
            {NOTIFICATIONS_COPY.badge(unread)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={NOTIFICATIONS_COPY.title}
          className="absolute right-0 z-20 mt-2 flex max-h-[28rem] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
        >
          <p className="border-b border-line px-4 py-3 text-compact font-semibold text-ink">{NOTIFICATIONS_COPY.title}</p>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {records === undefined && loading ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : null}
            {failed ? <p className="px-4 py-4 text-compact text-danger">{NOTIFICATIONS_COPY.failed}</p> : null}
            {records !== undefined && records.length === 0 && !failed ? (
              <p className="px-4 py-6 text-compact text-ink-muted">{NOTIFICATIONS_COPY.empty}</p>
            ) : null}
            {records !== undefined && records.length > 0 ? (
              <ul className="divide-y divide-line">
                {records.map((record) => {
                  const view = notificationView(record, now);
                  return (
                    <li key={view.id} className={`flex gap-3 px-4 py-3 ${view.unread ? 'bg-raised/60' : ''}`}>
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[view.tone]}`} aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-compact font-semibold text-ink">{view.title}</p>
                        <p className="mt-0.5 text-compact text-ink-muted">{view.body}</p>
                        <p className="mt-1 text-caption normal-case tracking-normal text-ink-faint">{view.when}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
          {cursor !== undefined ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => void load(cursor)}
              className="cursor-pointer border-t border-line px-4 py-2.5 text-compact font-semibold text-brand-600 transition-colors hover:bg-raised disabled:cursor-default disabled:opacity-60"
            >
              {loading ? NOTIFICATIONS_COPY.loading : NOTIFICATIONS_COPY.loadMore}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
