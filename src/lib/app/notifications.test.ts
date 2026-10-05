import { describe, expect, it } from 'vitest';
import type { NotificationRecord } from '@/lib/notifications';
import { NOTIFICATIONS_COPY, notificationAge, notificationView, planName, unreadIds } from './notifications';

const now = new Date('2026-10-03T12:00:00Z');

function record(kind: string, params: Record<string, unknown> = {}, extra: Partial<NotificationRecord> = {}): NotificationRecord {
  return { id: 'n1', kind, params, created_at: '2026-10-03T11:30:00Z', ...extra };
}

describe('notificationView', () => {
  it('writes every kind the API sends without a blank title or body', () => {
    const kinds = [
      'purchase_succeeded',
      'subscription_renewed',
      'payment_failed',
      'refunded',
      'expiring',
      'grace_started',
      'data_loss_countdown',
      'data_deleted',
    ];
    for (const kind of kinds) {
      const view = notificationView(record(kind), now);
      expect(view.title.length, kind).toBeGreaterThan(0);
      expect(view.body.length, kind).toBeGreaterThan(0);
      expect(view.body, kind).not.toContain('undefined');
    }
  });

  it('names the plan and the paid date', () => {
    const view = notificationView(record('purchase_succeeded', { plan: 'premium_2', paid_until: '2027-10-04T00:00:00Z' }), now);
    expect(view.title).toBe('Premium 2 is active');
    expect(view.body).toContain('2027');
    expect(view.tone).toBe('success');
  });

  it('counts down the days and the bytes over the free plan', () => {
    const view = notificationView(record('data_loss_countdown', { days_left: 1, over_bytes: 3 * 1024 ** 3 }), now);
    expect(view.title).toBe('Files will be deleted in 1 day');
    expect(view.body).toContain('3.0 GiB');
    expect(view.tone).toBe('danger');

    expect(notificationView(record('expiring', { plan: 'premium_1', days: 7 }), now).title).toBe('Premium 1 ends in 7 days');
  });

  it('ignores parameters of the wrong type', () => {
    const view = notificationView(record('data_deleted', { files: 'many', deleted_bytes: -4 }), now);
    expect(view.body).toBe('Files were deleted so your Drive fits your plan. Everything else is untouched.');
  });

  it('tells an ended plan from a smaller one', () => {
    const ended = notificationView(record('grace_started', { plan: 'premium_1', reason: 'ended', grace_ends_at: '2026-10-17T12:00:00Z' }), now);
    expect(ended.title).toBe('Premium 1 has ended');
    expect(ended.body).toContain('free plan');

    expect(notificationView(record('grace_started', { reason: 'ended' }), now).title).toBe('Your plan has ended');

    const smaller = notificationView(record('grace_started', { plan: 'premium_1', reason: 'smaller_plan' }), now);
    expect(smaller.title).toBe('Your Drive is larger than Premium 1 allows');
    expect(smaller.body).toContain('in 14 days');
    expect(smaller.body).not.toContain('free plan');
  });

  it('shows something sensible for a kind this version does not know', () => {
    const view = notificationView(record('lottery_won'), now);
    expect(view.title).toBe('Account notice');
    expect(view.tone).toBe('info');
  });

  it('is unread until the API recorded it read', () => {
    expect(notificationView(record('refunded'), now).unread).toBe(true);
    expect(notificationView(record('refunded', {}, { read_at: '2026-10-03T11:31:00Z' }), now).unread).toBe(false);
  });
});

describe('helpers', () => {
  it('names plans, and falls back to the code', () => {
    expect(planName('premium_1')).toBe('Premium 1');
    expect(planName('enterprise')).toBe('enterprise');
    expect(planName(undefined)).toBe('your plan');
  });

  it('says how long ago', () => {
    expect(notificationAge('2026-10-03T11:59:40Z', now)).toBe('Just now');
    expect(notificationAge('2026-10-03T11:30:00Z', now)).toBe('30 min ago');
    expect(notificationAge('2026-10-03T07:00:00Z', now)).toBe('5 h ago');
    expect(notificationAge('2026-10-02T11:00:00Z', now)).toBe('Yesterday');
    expect(notificationAge('2026-09-30T11:00:00Z', now)).toBe('3 days ago');
    expect(notificationAge('2026-09-01T11:00:00Z', now)).toContain('2026');
    expect(notificationAge('garbage', now)).toBe('');
  });

  it('lists what is unread, and labels the bell', () => {
    expect(unreadIds([record('refunded'), record('refunded', {}, { id: 'n2', read_at: 'x' })])).toEqual(['n1']);
    expect(NOTIFICATIONS_COPY.unreadLabel(0)).toBe('Notifications');
    expect(NOTIFICATIONS_COPY.unreadLabel(3)).toBe('Notifications, 3 unread');
    expect(NOTIFICATIONS_COPY.badge(250)).toBe('99+');
  });
});
