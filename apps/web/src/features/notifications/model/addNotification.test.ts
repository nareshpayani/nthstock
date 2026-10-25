import { NOTIFICATIONS_KEPT, type Notification } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { addNotification } from './addNotification';

const note = (id: string, read = false): Notification => ({
  id,
  kind: 'PRICE_ALERT',
  title: `Alert ${id}`,
  body: '',
  symbol: 'INFY',
  exchange: 'NSE',
  at: '2026-10-25T04:00:00.000Z',
  read,
});

describe('addNotification (NSTOCK-0384)', () => {
  it('puts a new notification first and bumps the unread count', () => {
    const list = { items: [note('ntf_1', true)], unread: 0 };
    expect(addNotification(list, note('ntf_2'))).toEqual({
      items: [note('ntf_2'), note('ntf_1', true)],
      unread: 1,
    });
  });

  it('does not bump the count for a notification that is already read', () => {
    expect(addNotification({ items: [], unread: 0 }, note('ntf_1', true)).unread).toBe(0);
  });

  it('returns the same list for an id it already holds', () => {
    const list = { items: [note('ntf_1')], unread: 1 };
    expect(addNotification(list, note('ntf_1'))).toBe(list);
  });

  it('keeps the newest NOTIFICATIONS_KEPT, and the dropped unread one leaves the count', () => {
    const items = Array.from({ length: NOTIFICATIONS_KEPT }, (_, i) =>
      note(`ntf_${i}`, i < NOTIFICATIONS_KEPT - 1),
    );
    const next = addNotification({ items, unread: 1 }, note('ntf_new'));
    expect(next.items).toHaveLength(NOTIFICATIONS_KEPT);
    expect(next.items[0]?.id).toBe('ntf_new');
    expect(next.items.at(-1)?.id).toBe(`ntf_${NOTIFICATIONS_KEPT - 2}`);
    expect(next.unread).toBe(1);
  });
});
