import type { OrderHistoryEntry } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { orderTimeline } from './orderTimeline';

const entry = (overrides: Partial<OrderHistoryEntry>): OrderHistoryEntry => ({
  event: 'PLACED',
  status: 'OPEN',
  at: '2026-09-28T04:30:00.000Z',
  qty: 10,
  type: 'LIMIT',
  price: 145_000,
  fillPrice: null,
  note: null,
  ...overrides,
});

describe('order timeline (T-146)', () => {
  it('gives every transition an IST time and a plain description', () => {
    const steps = orderTimeline([
      entry({}),
      entry({ event: 'MODIFIED', at: '2026-09-28T04:31:05.000Z', qty: 12, price: 146_000 }),
      entry({
        event: 'EXECUTED',
        status: 'EXECUTED',
        at: '2026-09-28T04:32:10.000Z',
        qty: 12,
        price: 146_000,
        fillPrice: 146_000,
      }),
    ]);
    expect(
      steps.map((s) => [s.label, s.time.toLowerCase(), s.date.replace('Sept', 'Sep'), s.detail]),
    ).toEqual([
      ['Placed', '10:00:00 am', '28 Sep 2026', '10 shares at ₹1,450.00'],
      ['Modified', '10:01:05 am', '28 Sep 2026', '12 shares at ₹1,460.00'],
      ['Executed', '10:02:10 am', '28 Sep 2026', 'Filled 12 at ₹1,460.00'],
    ]);
    expect(steps.map((s) => s.tone)).toEqual(['neutral', 'neutral', 'up']);
    expect(steps[0]?.at).toBe('2026-09-28T04:30:00.000Z');
  });

  it('shows reasons for cancels and rejections, and the AMO wait', () => {
    const steps = orderTimeline([
      entry({ status: 'AMO', type: 'MARKET', price: null }),
      entry({ event: 'RELEASED', status: 'OPEN', type: 'MARKET', price: null }),
      entry({ event: 'CANCELLED', status: 'CANCELLED', note: 'Cancelled by you.' }),
      entry({ status: 'REJECTED', note: 'Not enough cash.' }),
      entry({ event: 'REJECTED', status: 'REJECTED', note: null }),
    ]);
    expect(steps.map((s) => [s.label, s.detail])).toEqual([
      ['Placed', 'Waiting for 9:15 AM IST as an after-market order'],
      ['Sent to the exchange', '10 shares at Market'],
      ['Cancelled', 'Cancelled by you.'],
      ['Placed · Rejected', 'Not enough cash.'],
      ['Rejected', 'Rejected'],
    ]);
    expect(steps[3]?.tone).toBe('down');
  });
});
