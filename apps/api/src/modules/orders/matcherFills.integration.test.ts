import {
  MATCHER_FILLS_GROUP,
  routes,
  type MatcherFill,
  type Order,
  type OrderHistoryResponse,
  type Quote,
} from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { shardOf } from '@nthstock/utils';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
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

  async function boot(prefix: string, fillClaimIdleMs = 30_000) {
    const clock = manualClock(AT);
    const market = new MockMarketDataAdapter({ master, clock, externalTicks: true });
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
          fillClaimIdleMs,
          blockMs: 100,
          log: silent,
        },
      },
      orderSweepMs: null,
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
    return { app, user, headers, order, get, history };
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
    const { user, order, get } = await boot(prefix, 200);
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
});
