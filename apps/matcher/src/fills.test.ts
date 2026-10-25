import { MATCHER_FILL_MAX_IDS, MatcherFill } from '@nthstock/contracts';
import { OrderBook, type BookOrder, type BookStop } from '@nthstock/paperEngine';
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
    expect(lines).toEqual(['Sending a matcher fill failed', 'Sending matcher fills recovered']);
  });

  it('puts a triggered stop back as TRAILING when its request fails, and logs the ids (NSTOCK-0388)', async () => {
    const book = new OrderBook();
    const stop: BookStop = {
      stopId: 'st1',
      userId: 'u1',
      version: 4,
      state: {
        status: 'TRAILING',
        direction: 'LONG',
        trail: { unit: 'AMOUNT', amount: 5_00 },
        activationPrice: null,
        watermarkPrice: 105_00,
        stopPrice: 100_00,
      },
    };
    book.upsertStop(stop);
    book.upsertOrder(order('o1', 'u1'));
    const acted = book.tick(99_95);
    expect(acted.triggered.map((s) => s.state.status)).toEqual(['TRIGGERED']);
    expect(book.size).toEqual({ orders: 0, stops: 0, alerts: 0 });

    const warnings: { message: string; fields?: Record<string, unknown> }[] = [];
    const info: { message: string; fields?: Record<string, unknown> }[] = [];
    let down = true;
    const write = createFillWriter({
      stream: {
        xadd: async () => {
          if (down) throw new Error('READONLY replica');
          return '1-0';
        },
      },
      shard: 2,
      book: () => book,
      log: {
        info: (message, fields) => info.push({ message, ...(fields ? { fields } : {}) }),
        warn: (message, fields) => warnings.push({ message, ...(fields ? { fields } : {}) }),
      },
    });
    const failedTick: MatcherTick = { ...acted, token: 7, symbol: 'TEST', ltp: 99_95, ts: 'x' };
    await write(failedTick);

    expect(warnings).toEqual([
      {
        message: 'Sending a matcher fill failed',
        fields: {
          shard: 2,
          token: 7,
          userId: 'u1',
          orderIds: ['o1'],
          stopIds: ['st1'],
          reason: 'READONLY replica',
        },
      },
    ]);
    // Both are back at their version; the stop where the tick left it, so it triggers again.
    expect([...book.stops()]).toEqual([stop]);
    expect([...book.orders()].map((o) => o.orderId)).toEqual(['o1']);
    expect(book.tick(99_95).triggered.map((s) => s.stopId)).toEqual(['st1']);

    // A second failure in the same outage is counted, not logged.
    await write(failedTick);
    down = false;
    await write(failedTick);
    expect(warnings).toHaveLength(1);
    expect(info).toEqual([
      { message: 'Sending matcher fills recovered', fields: { shard: 2, failedSends: 2 } },
    ]);
  });
});

describe('fillsFor ids (NSTOCK-0388)', () => {
  it('names at most the contract maximum of ids, still in one request', () => {
    const many = Array.from({ length: MATCHER_FILL_MAX_IDS + 5 }, (_, i) =>
      order(`o${String(i)}`, 'u1'),
    );
    const fills = fillsFor(tick(many, ['u1']));
    expect(fills).toHaveLength(1);
    expect(fills[0]?.orderIds).toHaveLength(MATCHER_FILL_MAX_IDS);
    expect(MatcherFill.safeParse(fills[0]).success).toBe(true);
  });
});
