import {
  MATCHER_FILLS_GROUP,
  routes,
  TICK_BATCH_VERSION,
  type MatcherFill,
  type Order,
  type OrderHistoryResponse,
  type Quote,
} from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { shardOf } from '@nthstock/utils';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { startMatcherFills } from './matcherFills.js';
import { loginWithOtp } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';
import {
  describeWithRedis,
  startTestRedis,
  uniqueChannel,
  type TestRedis,
} from '../../test/testRedis.js';

// NSTOCK-0367 acceptance (ADR 0013): apps/api commits the matcher's fill requests from the fill
// stream, once each, after a process that took one died, and never for an order changed since.

const SHARDS = 2;
const master = generateSymbolMaster({ equityCount: 20 });
const EQUITY = master.equities[0]?.instrument;
const TOKEN = EQUITY?.token ?? 0;
const SHARD = shardOf(TOKEN, SHARDS);
const AT = '2026-09-28T04:30:00.000Z'; // Monday 10:00 IST, market open
const silent = { info: () => undefined, warn: () => undefined };

describeWithRedis('matcher fills into apps/api (integration, NSTOCK-0367)', () => {
  let redis: TestRedis | undefined;
  let client: Redis;
  const apps: App[] = [];

  beforeAll(async () => {
    redis = await startTestRedis();
    client = new Redis(redis.url);
  }, 180_000);

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
  });

  afterAll(async () => {
    client.disconnect();
    await redis?.stop();
  });

  async function boot(
    prefix: string,
    { fillClaimIdleMs = 30_000, matcherMode = 'inline' as 'inline' | 'worker' } = {},
  ) {
    const clock = manualClock(AT);
    const market = new MockMarketDataAdapter({ master, clock, externalTicks: true });
    const subscribe = vi.spyOn(market, 'subscribe');
    const base = (await new MockMarketDataAdapter({ master }).getQuote(
      EQUITY?.symbol ?? '',
    )) as Quote;
    // The quote service's last price, so a BUY LIMIT below it rests.
    await client.hset(
      `${prefix}:last:${String(SHARD)}`,
      String(TOKEN),
      JSON.stringify({ ...base, ltp: 1_400_00, ts: AT }),
    );
    const app = buildApp({
      deps: {
        clock,
        market,
        quoteStreams: {
          url: redis?.url ?? '',
          shards: SHARDS,
          streamKey: (s) => `${prefix}:ticks:${String(s)}`,
          snapshotKey: (s) => `${prefix}:last:${String(s)}`,
          commandsKey: (s) => `${prefix}:commands:${String(s)}`,
          fillsKey: (s) => `${prefix}:fills:${String(s)}`,
          fillsDeadKey: `${prefix}:fills:dead`,
          fillClaimIdleMs,
          blockMs: 100,
          log: silent,
        },
        matcherMode,
      },
      ...(matcherMode === 'inline' ? { orderSweepMs: null } : {}),
    });
    app.addHook('onClose', () => market.dispose());
    apps.push(app);
    await app.ready();
    const user = await loginWithOtp(app, '9876500021');
    const headers = { authorization: `Bearer ${user.access}`, 'x-csrf-token': 'bearer' };
    const placed = await app.inject({
      method: 'POST',
      url: routes.orderPlace.path,
      headers,
      payload: {
        token: TOKEN,
        side: 'BUY',
        type: 'LIMIT',
        price: 1_390_00,
        product: 'DELIVERY',
        qty: 2,
      },
    });
    expect(placed.statusCode, placed.body).toBe(200);
    const order = placed.json() as Order;
    expect(order.status).toBe('OPEN');
    const get = async () =>
      (await app.inject({ method: 'GET', url: `/v1/orders/${order.id}`, headers })).json() as Order;
    const history = async () =>
      (
        await app.inject({ method: 'GET', url: `/v1/orders/${order.id}/history`, headers })
      ).json() as OrderHistoryResponse;
    return { app, user, headers, order, get, history, subscribe, base, market };
  }

  const fill = (userId: string, orderId: string, ltp: number): MatcherFill => ({
    v: 1,
    userId,
    token: TOKEN,
    ltp,
    ts: AT,
    orderIds: [orderId],
    stopIds: [],
  });
  const send = (prefix: string, value: MatcherFill | string) =>
    client.xadd(
      `${prefix}:fills:${String(SHARD)}`,
      '*',
      'fill',
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  const pending = async (prefix: string) =>
    (
      (await client.xpending(`${prefix}:fills:${String(SHARD)}`, MATCHER_FILLS_GROUP)) as [number]
    )[0];

  it('fills a resting order once, even when the request arrives twice', async () => {
    const prefix = uniqueChannel('fills');
    const { user, order, get, history } = await boot(prefix);
    const request = fill(user.session.user.id, order.id, 1_385_00);
    await send(prefix, request);
    await expect.poll(async () => (await get()).status, { timeout: 10_000 }).toBe('EXECUTED');
    expect(await get()).toMatchObject({ filledQty: 2, avgFillPrice: 1_390_00 });

    // A replay (a matcher restarted mid-batch) and a malformed entry change nothing.
    await send(prefix, request);
    await send(prefix, '{');
    await expect.poll(() => pending(prefix), { timeout: 10_000 }).toBe(0);
    await expect
      .poll(async () => await client.xlen(`${prefix}:fills:${String(SHARD)}`), { timeout: 5_000 })
      .toBe(3);
    const executed = (await history()).items.filter((entry) => entry.event === 'EXECUTED');
    expect(executed).toHaveLength(1);
    // The malformed one is kept for an operator on the dead-letter stream (NSTOCK-0388).
    const dead = await client.xrange(`${prefix}:fills:dead`, '-', '+');
    expect(dead.map(([, fields]) => fields.slice(4, 6))).toEqual([
      ['reason', 'malformed: not JSON'],
    ]);
  }, 60_000);

  it('drops a request for an order modified away from the price since', async () => {
    const prefix = uniqueChannel('fills');
    const { app, user, headers, order, get } = await boot(prefix);
    const modified = await app.inject({
      method: 'PATCH',
      url: `/v1/orders/${order.id}`,
      headers,
      payload: { price: 1_380_00 },
    });
    expect(modified.statusCode, modified.body).toBe(200);
    // The book had the old price when the tick crossed it.
    await send(prefix, fill(user.session.user.id, order.id, 1_385_00));
    await expect.poll(() => pending(prefix), { timeout: 10_000 }).toBe(0);
    expect(await get()).toMatchObject({ status: 'OPEN', filledQty: 0, price: 1_380_00 });
  }, 60_000);

  it('takes over a request a crashed process read and never acked', async () => {
    const prefix = uniqueChannel('fills');
    const key = `${prefix}:fills:${String(SHARD)}`;
    const { user, order, get } = await boot(prefix, { fillClaimIdleMs: 200 });
    // Another process reads the request in the same transaction that writes it, so it is the one
    // that holds it, and then dies before it commits.
    const results = await client
      .multi()
      .xadd(key, '*', 'fill', JSON.stringify(fill(user.session.user.id, order.id, 1_385_00)))
      .xreadgroup('GROUP', MATCHER_FILLS_GROUP, 'crashed', 'COUNT', 1, 'STREAMS', key, '>')
      .exec();
    expect(results?.every(([error]) => error === null)).toBe(true);

    // This process claims it once it has been idle for the claim time, and commits it.
    await expect.poll(async () => (await get()).status, { timeout: 10_000 }).toBe('EXECUTED');
    await expect.poll(() => pending(prefix), { timeout: 10_000 }).toBe(0);
  }, 60_000);

  it('follows no ticks with MATCHER_MODE=worker, and fills from the matcher alone (NSTOCK-0369)', async () => {
    const prefix = uniqueChannel('fills');
    const { app, user, headers, order, get, subscribe, base, market } = await boot(prefix, {
      matcherMode: 'worker',
    });
    // A MARKET order still fills at the quote service's last price.
    const bought = await app.inject({
      method: 'POST',
      url: routes.orderPlace.path,
      headers,
      payload: { token: TOKEN, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty: 1 },
    });
    expect(bought.json()).toMatchObject({ status: 'EXECUTED', avgFillPrice: 1_400_00 });

    // A crossing tick on the quote stream reaches no engine here: the resting order waits.
    const crossing = { ...base, ltp: 1_380_00, ts: AT };
    const batch = { v: TICK_BATCH_VERSION, shard: SHARD, seq: 1, quotes: [crossing] };
    await client.xadd(`${prefix}:ticks:${String(SHARD)}`, '*', 'batch', JSON.stringify(batch));
    await expect
      .poll(async () => (await market.getQuote(EQUITY?.symbol ?? ''))?.ltp, { timeout: 10_000 })
      .toBe(1_380_00);
    expect((await get()).status).toBe('OPEN');

    await send(prefix, fill(user.session.user.id, order.id, 1_385_00));
    await expect.poll(async () => (await get()).status, { timeout: 10_000 }).toBe('EXECUTED');
    expect(subscribe).not.toHaveBeenCalled();
  }, 60_000);
});

describeWithRedis('matcher fill reader on Redis (integration, NSTOCK-0388)', () => {
  let redis: TestRedis | undefined;
  let client: Redis;

  beforeAll(async () => {
    redis = await startTestRedis();
    client = new Redis(redis.url);
  }, 180_000);

  afterAll(async () => {
    client.disconnect();
    await redis?.stop();
  });

  const request = (userId: string): MatcherFill => ({
    v: 1,
    userId,
    token: 1,
    ltp: 100_00,
    ts: AT,
    orderIds: ['o1'],
    stopIds: [],
  });

  it('claims a failing request page by page until its cap, then dead-letters it', async () => {
    const prefix = uniqueChannel('fillcap');
    const key = `${prefix}:fills:0`;
    // 250 requests a crashed process read and never acked: three XAUTOCLAIM pages of 100.
    for (let i = 0; i < 250; i += 1) {
      await client.xadd(key, '*', 'fill', JSON.stringify(request(`u${String(i)}`)));
    }
    await client.xgroup('CREATE', key, MATCHER_FILLS_GROUP, '0');
    await client.xreadgroup(
      'GROUP',
      MATCHER_FILLS_GROUP,
      'crashed',
      'COUNT',
      250,
      'STREAMS',
      key,
      '>',
    );

    const tries = new Map<string, number>();
    const reader = new Redis(redis?.url ?? '', { maxRetriesPerRequest: null });
    const cleanup = new Redis(redis?.url ?? '');
    const fills = startMatcherFills({
      orders: {
        applyMatcherFill: async (fill) => {
          tries.set(fill.userId, (tries.get(fill.userId) ?? 0) + 1);
          if (fill.userId === 'u7') throw new Error('always fails');
        },
      },
      client: reader,
      cleanup,
      shards: 1,
      consumer: 'c1',
      log: silent,
      blockMs: 20,
      claimIdleMs: 100,
      maxDeliveries: 3,
      fillsKey: (shard) => `${prefix}:fills:${String(shard)}`,
      deadLetterKey: `${prefix}:dead`,
    });
    try {
      await expect
        .poll(async () => (await client.xlen(`${prefix}:dead`)) === 1, { timeout: 15_000 })
        .toBe(true);
      await expect
        .poll(async () => ((await client.xpending(key, MATCHER_FILLS_GROUP)) as [number])[0], {
          timeout: 5_000,
        })
        .toBe(0);
      // Every page was followed; u7 ran on deliveries 2 and 3 (the crashed read was the first).
      expect(tries.size).toBe(250);
      expect(tries.get('u7')).toBe(2);
      expect(tries.get('u200')).toBe(1);
      const [[, fields] = ['', []]] = await client.xrange(`${prefix}:dead`, '-', '+');
      expect(fields.slice(0, 6)).toEqual([
        'source',
        key,
        'id',
        fields[3],
        'reason',
        'delivered 3 times',
      ]);
      expect(JSON.parse(fields[7] ?? '')).toMatchObject({ userId: 'u7' });
    } finally {
      await fills.close();
      cleanup.disconnect();
    }
    // Holding nothing, c1 left the group on close; the crashed consumer stays.
    const consumers = (await client.xinfo('CONSUMERS', key, MATCHER_FILLS_GROUP)) as unknown[][];
    expect(consumers.map((row) => row[1])).toEqual(['crashed']);
  }, 60_000);
});
