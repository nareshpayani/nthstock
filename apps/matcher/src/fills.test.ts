import { MatcherFill } from '@nthstock/contracts';
import { OrderBook, type BookOrder } from '@nthstock/paperEngine';
import { describe, expect, it } from 'vitest';
import { createFillWriter, fillsFor, type FillStream } from './fills.js';
import type { MatcherTick } from './matcher.js';

const order = (orderId: string, userId: string): BookOrder => ({
  orderId,
  userId,
  version: 3,
  side: 'BUY',
  price: 100_00,
});

const tick = (crossed: BookOrder[], triggeredBy: string[] = []): MatcherTick => ({
  token: 7,
  symbol: 'TEST',
  ltp: 99_95,
  ts: '2026-09-28T04:30:00.250Z',
  read: crossed.length,
  crossed,
  moved: [],
  alerts: [],
  triggered: triggeredBy.map((userId, i) => ({
    stopId: `s${String(i)}`,
    userId,
    version: 1,
    state: {
      status: 'TRIGGERED',
      direction: 'LONG',
      trail: { unit: 'AMOUNT', amount: 5_00 },
      activationPrice: null,
      watermarkPrice: 105_00,
      stopPrice: 100_00,
    },
  })),
});

describe('fillsFor (NSTOCK-0367)', () => {
  it('sends one request per user, with the orders and stops the tick acted on', () => {
    const fills = fillsFor(tick([order('o1', 'u1'), order('o2', 'u2'), order('o3', 'u1')], ['u2']));
    expect(fills.map((fill) => MatcherFill.parse(fill))).toEqual([
      {
        v: 1,
        userId: 'u1',
        token: 7,
        ltp: 99_95,
        ts: '2026-09-28T04:30:00.250Z',
        orderIds: ['o1', 'o3'],
        stopIds: [],
      },
      {
        v: 1,
        userId: 'u2',
        token: 7,
        ltp: 99_95,
        ts: '2026-09-28T04:30:00.250Z',
        orderIds: ['o2'],
        stopIds: ['s0'],
      },
    ]);
  });
});

describe('createFillWriter (NSTOCK-0367)', () => {
  it('puts back the orders whose request failed, and logs a failing stream once', async () => {
    const book = new OrderBook();
    const crossed = [order('o1', 'u1'), order('o2', 'u2')];
    for (const o of crossed) book.upsertOrder(o);
    expect(book.tick(99_95).crossed).toHaveLength(2);

    const sent: { key: string; fill: MatcherFill }[] = [];
    let downFor: string | null = 'u2';
    const stream: FillStream = {
      xadd: async (key, _m, _a, _c, _id, _f, value) => {
        const fill = MatcherFill.parse(JSON.parse(value));
        if (fill.userId === downFor) throw new Error('connection refused');
        sent.push({ key, fill });
        return '1-0';
      },
    };
    const lines: string[] = [];
    const write = createFillWriter({
      stream,
      shard: 1,
      book: () => book,
      log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) },
      fillsKey: (shard) => `fills:${String(shard)}`,
    });

    await write(tick(crossed));
    await write(tick([]));
    expect(sent.map((s) => [s.key, s.fill.userId])).toEqual([['fills:1', 'u1']]);
    // u2's order is back at the same version, so the next crossing tick asks again.
    expect([...book.orders()].map((o) => [o.orderId, o.version])).toEqual([['o2', 3]]);

    await write(tick(crossed));
    downFor = null;
    await write(tick(crossed));
    expect(lines).toEqual(['Sending matcher fills failed', 'Sending matcher fills recovered']);
  });
});
