import { MatcherCommand, routes, type Quote } from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { shardOf } from '@nthstock/utils';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loginWithOtp } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';
import {
  describeWithRedis,
  startTestRedis,
  uniqueChannel,
  type TestRedis,
} from '../../test/testRedis.js';

// NSTOCK-0365 acceptance: place, modify and cancel through the API each put one command, with a
// growing version, on the command stream of the instrument's shard.

const SHARDS = 2;
const master = generateSymbolMaster({ equityCount: 20 });
const EQUITY = master.equities[0]?.instrument;
const TOKEN = EQUITY?.token ?? 0;
const silent = { info: () => undefined, warn: () => undefined };

describeWithRedis('matcher commands from apps/api (integration, NSTOCK-0365)', () => {
  let redis: TestRedis | undefined;
  let reader: Redis;

  beforeAll(async () => {
    redis = await startTestRedis();
    reader = new Redis(redis.url);
  }, 180_000);

  afterAll(async () => {
    reader.disconnect();
    await redis?.stop();
  });

  async function startApp(phone: string) {
    const url = redis?.url ?? '';
    const prefix = uniqueChannel('commands');
    const clock = manualClock('2026-09-28T04:30:00.000Z'); // Monday 10:00 IST, market open
    const market = new MockMarketDataAdapter({ master, clock, externalTicks: true });
    // The quote service's last price, so a BUY LIMIT below it rests.
    const base = (await new MockMarketDataAdapter({ master }).getQuote(
      EQUITY?.symbol ?? '',
    )) as Quote;
    const shard = shardOf(TOKEN, SHARDS);
    await reader.hset(
      `${prefix}:last:${String(shard)}`,
      String(TOKEN),
      JSON.stringify({ ...base, ltp: 1_400_00 }),
    );
    const app = buildApp({
      deps: {
        clock,
        market,
        quoteStreams: {
          url,
          shards: SHARDS,
          streamKey: (s) => `${prefix}:ticks:${String(s)}`,
          snapshotKey: (s) => `${prefix}:last:${String(s)}`,
          commandsKey: (s) => `${prefix}:commands:${String(s)}`,
          blockMs: 100,
          log: silent,
        },
      },
      orderSweepMs: null,
    });
    app.addHook('onClose', () => market.dispose());
    await app.ready();
    const user = await loginWithOtp(app, phone);
    const headers = { authorization: `Bearer ${user.access}`, 'x-csrf-token': 'bearer' };

    return { app, prefix, shard, headers, user, clock };
  }

  it('sends ADD, MODIFY and CANCEL for a LIMIT order, in version order', async () => {
    const { app, prefix, shard, headers, user, clock } = await startApp('9876500011');

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
    const orderId = (placed.json() as { id: string }).id;
    clock.advance(1_000);
    const modified = await app.inject({
      method: 'PATCH',
      url: `/v1/orders/${orderId}`,
      headers,
      payload: { price: 1_385_00 },
    });
    expect(modified.statusCode, modified.body).toBe(200);
    const cancelled = await app.inject({ method: 'DELETE', url: `/v1/orders/${orderId}`, headers });
    expect(cancelled.statusCode, cancelled.body).toBe(200);

    const key = `${prefix}:commands:${String(shard)}`;
    await expect.poll(async () => await reader.xlen(key), { timeout: 10_000 }).toBe(3);
    const commands = (await reader.xrange(key, '-', '+')).map(([, fields]) =>
      MatcherCommand.parse(JSON.parse(fields[1] ?? '')),
    );
    expect(commands.map((c) => c.type)).toEqual(['ADD', 'MODIFY', 'CANCEL']);
    expect(commands.map((c) => c.token)).toEqual([TOKEN, TOKEN, TOKEN]);
    expect(commands[1]).toMatchObject({
      orderId,
      userId: user.session.user.id,
      side: 'BUY',
      price: 1_385_00,
    });
    const versions = commands.map((c) => c.version);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
    expect(new Set(versions).size).toBe(3);
    // Nothing went to the other shard.
    expect(await reader.xlen(`${prefix}:commands:${String(1 - shard)}`)).toBe(0);

    await app.close();
  }, 60_000);

  it('sends STOP_ADD and STOP_CANCEL for a trailing stop (NSTOCK-0368)', async () => {
    const { app, prefix, shard, headers } = await startApp('9876500012');

    const bought = await app.inject({
      method: 'POST',
      url: routes.orderPlace.path,
      headers,
      payload: { token: TOKEN, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty: 2 },
    });
    expect(bought.statusCode, bought.body).toBe(200);
    const placed = await app.inject({
      method: 'POST',
      url: routes.trailingStopPlace.path,
      headers,
      payload: {
        token: TOKEN,
        product: 'DELIVERY',
        trail: { unit: 'AMOUNT', amount: 10_00 },
        activationPrice: null,
        exitOrderType: 'MARKET',
        exitLimitOffset: null,
      },
    });
    expect(placed.statusCode, placed.body).toBe(200);
    const stopId = (placed.json() as { id: string }).id;
    const cancelled = await app.inject({
      method: 'DELETE',
      url: `/v1/trailing-stops/${stopId}`,
      headers,
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);

    const key = `${prefix}:commands:${String(shard)}`;
    await expect.poll(async () => await reader.xlen(key), { timeout: 10_000 }).toBe(2);
    const commands = (await reader.xrange(key, '-', '+')).map(([, fields]) =>
      MatcherCommand.parse(JSON.parse(fields[1] ?? '')),
    );
    expect(commands.map((c) => c.type)).toEqual(['STOP_ADD', 'STOP_CANCEL']);
    expect(commands[0]).toMatchObject({
      stopId,
      token: TOKEN,
      state: { status: 'TRAILING', direction: 'LONG', trail: { unit: 'AMOUNT', amount: 10_00 } },
    });
    expect(commands[1]).toMatchObject({ stopId, type: 'STOP_CANCEL' });
    expect(commands[0]?.version).toBeLessThan(commands[1]?.version ?? 0);

    await app.close();
  }, 60_000);
});
