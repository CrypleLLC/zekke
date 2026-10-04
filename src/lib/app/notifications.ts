import { isKnownKind, type NotificationRecord } from '@/lib/notifications';
import { formatBytes } from './vault';

export type NotificationTone = 'info' | 'success' | 'warning' | 'danger';

export interface NotificationView {
  id: string;
  title: string;
  body: string;
  tone: NotificationTone;
  when: string;
  unread: boolean;
}

export const NOTIFICATIONS_COPY = {
  open: 'Notifications',
  title: 'Notifications',
  empty: 'Nothing new. Notices about your plan and your storage appear here.',
  loadMore: 'Show older',
  loading: 'Loading…',
  failed: 'Notifications could not be loaded. Try again in a moment.',
  unreadLabel: (count: number) =>
    count === 0 ? 'Notifications' : count === 1 ? 'Notifications, 1 unread' : `Notifications, ${count} unread`,
  badge: (count: number) => (count > 99 ? '99+' : String(count)),
} as const;

const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  premium_1: 'Premium 1',
  premium_2: 'Premium 2',
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function planName(code: unknown): string {
  return typeof code === 'string' ? (PLAN_NAMES[code] ?? code) : 'your plan';
}

export function notificationDate(at: unknown): string | undefined {
  if (typeof at !== 'string') {
    return undefined;
  }
  const moment = new Date(at);
  if (Number.isNaN(moment.getTime())) {
    return undefined;
  }
  return moment.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function notificationAge(at: string, now: Date = new Date()): string {
  const moment = new Date(at);
  if (Number.isNaN(moment.getTime())) {
    return '';
  }

  const elapsed = Math.max(0, now.getTime() - moment.getTime());
  if (elapsed < MINUTE) {
    return 'Just now';
  }
  if (elapsed < HOUR) {
    return `${Math.floor(elapsed / MINUTE)} min ago`;
  }
  if (elapsed < DAY) {
    return `${Math.floor(elapsed / HOUR)} h ago`;
  }
  if (elapsed < 7 * DAY) {
    const days = Math.floor(elapsed / DAY);
    return days === 1 ? 'Yesterday' : `${days} days ago`;
  }
  return notificationDate(at) ?? '';
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function days(value: number): string {
  return value === 1 ? '1 day' : `${value} days`;
}

function until(at: unknown): string {
  const date = notificationDate(at);
  return date === undefined ? '' : ` until ${date}`;
}

function copyFor(record: NotificationRecord): Pick<NotificationView, 'title' | 'body' | 'tone'> {
  const params = record.params;
  const plan = planName(params.plan);

  if (!isKnownKind(record.kind)) {
    return {
      title: 'Account notice',
      body: 'Something changed on your account. Update the app to read the details.',
      tone: 'info',
    };
  }

  switch (record.kind) {
    case 'purchase_succeeded':
      return {
        title: `${plan} is active`,
        body: `Thank you. Your payment went through and ${plan} is yours${until(params.paid_until)}.`,
        tone: 'success',
      };
    case 'subscription_renewed':
      return {
        title: `${plan} renewed`,
        body: `Your subscription renewed${until(params.paid_until)}.`,
        tone: 'success',
      };
    case 'payment_failed':
      return {
        title: 'A payment failed',
        body:
          `Your card could not be charged for ${plan}. It will be tried again; you can update it from ` +
          'Manage subscription. Nothing changes until the time you paid for ends.',
        tone: 'warning',
      };
    case 'refunded':
      return {
        title: 'A payment was refunded',
        body: `A payment for ${plan} was refunded, and the time it paid for was removed from your plan.`,
        tone: 'info',
      };
    case 'expiring': {
      const left = count(params.days);
      return {
        title: left === undefined ? `${plan} ends soon` : `${plan} ends in ${days(left)}`,
        body:
          `Renew to keep your storage and features. When it ends, your files stay readable for 14 days, ` +
          'then the Drive is cut down to the free plan.',
        tone: 'warning',
      };
    }
    case 'grace_started': {
      const deadline =
        notificationDate(params.grace_ends_at) === undefined ? 'in 14 days' : `on ${notificationDate(params.grace_ends_at)}`;
      if (params.reason === 'smaller_plan') {
        return {
          title: `Your Drive is larger than ${plan} allows`,
          body:
            `Everything stays readable, and you can download or delete anything. New uploads stop, and ${deadline} ` +
            `the most recent uploads are deleted until the Drive fits ${plan}. Choose a larger plan, or delete files yourself.`,
          tone: 'danger',
        };
      }
      return {
        title: typeof params.plan === 'string' ? `${plan} has ended` : 'Your plan has ended',
        body:
          'Your files are safe for now: everything stays readable and you can download or delete anything. ' +
          `New uploads stop above the free plan, and the Drive is cut down to it ${deadline}. Renewing restores everything.`,
        tone: 'danger',
      };
    }
    case 'data_loss_countdown': {
      const left = count(params.days_left);
      const over = count(params.over_bytes);
      return {
        title: left === undefined ? 'Files will be deleted soon' : `Files will be deleted in ${days(left)}`,
        body:
          (over === undefined
            ? 'Your Drive holds more than your plan allows.'
            : `Your Drive holds ${formatBytes(over)} more than your plan allows.`) +
          ' Renew, or download and delete files yourself, before the most recent uploads are deleted for good.',
        tone: 'danger',
      };
    }
    case 'data_deleted': {
      const files = count(params.files);
      const bytes = count(params.deleted_bytes);
      const what =
        files === undefined
          ? 'Files were'
          : files === 1
            ? '1 file was'
            : `${files} files were`;
      return {
        title: 'Files were deleted',
        body:
          `${what} deleted${bytes === undefined ? '' : ` (${formatBytes(bytes)})`} so your Drive fits your plan. ` +
          'Everything else is untouched.',
        tone: 'danger',
      };
    }
  }
}

export function notificationView(record: NotificationRecord, now: Date = new Date()): NotificationView {
  return {
    id: record.id,
    ...copyFor(record),
    when: notificationAge(record.created_at, now),
    unread: record.read_at === undefined,
  };
}

export function unreadIds(records: readonly NotificationRecord[]): string[] {
  return records.filter((record) => record.read_at === undefined).map((record) => record.id);
}
