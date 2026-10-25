import {
  CONSENT_POLICY_VERSION,
  DEV_OTP,
  OtpRequestResponse,
  Session,
  routes,
  type MatcherFill,
  type Order,
  type Quote,
} from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { shardOf } from '@nthstock/utils';
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import type { App } from '../../app.js';
import { PRE_SESSION_CSRF } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';
import { describeWithPostgresAndRedis } from '../../test/postgresRedisApp.js';

// NSTOCK-0370: the commit half of tick to fill (ADR 0013), measured on Postgres and Redis. Users
// rest a BUY LIMIT each; the matcher's fill requests for all of them land on the fill stream in
// one burst, as from one tick that crosses every order; apps/api (MATCHER_MODE=worker) reads them
// in its consumer group and commits each through the account store. Each latency runs from the
// XADD to the order update, which apps/api announces only after the commit. The book's own cost
// and the matcher's side of the hop are in tools/loadTest/matcher.mjs. MATCHER_BENCH_USERS sizes
// the burst (default 100); docs/runbooks/load-test.md "Matcher" has the full result.

const USERS = Number(process.env['MATCHER_BENCH_USERS'] ?? 100);
/** Fill requests a second in the steady half (MATCHER_BENCH_RATE). */
const RATE = Number(process.env['MATCHER_BENCH_RATE'] ?? 100);
const SHARDS = 2;
const master = generateSymbolMaster({ equityCount: 20 });
const EQUITY = master.equities[0]?.instrument;
const TOKEN = EQUITY?.token ?? 0;
const SHARD = shardOf(TOKEN, SHARDS);
const AT = '2026-09-28T04:30:00.000Z'; // Monday 10:00 IST, market open
const silent = { info: () => undefined, warn: () => undefined };

/** Logs a user in from an address of their own, so the per-IP OTP limits hold for each. */
async function login(
  app: App,
  i: number,
): Promise<{ userId: string; access: string; remoteAddress: string }> {
  const remoteAddress = `10.${String(Math.floor(i / 250))}.${String(i % 250)}.1`;
  const mobile = `98${String(70_000_000 + i)}`;
  const requested = await app.inject({
    method: 'POST',
    url: routes.otpRequest.path,
    headers: PRE_SESSION_CSRF,
    remoteAddress,
    payload: { mobile },
  });
  const { requestId } = OtpRequestResponse.parse(requested.json());
  const verified = await app.inject({
    method: 'POST',
    url: routes.otpVerify.path,
    headers: PRE_SESSION_CSRF,
    remoteAddress,
    payload: { requestId, mobile, otp: DEV_OTP, consentVersion: CONSENT_POLICY_VERSION },
  });
  const session = Session.parse(verified.json());
  return { userId: session.user.id, access: session.accessToken, remoteAddress };
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
};

describeWithPostgresAndRedis('matcher fill commit latency (integration, NSTOCK-0370)', (h) => {
  it('commits steady fill requests with a p95 under 100 ms, and reports a burst', async () => {
    const prefix = h.prefix();
    const redis = h.redis();
    const clock = manualClock(AT);
    const market = new MockMarketDataAdapter({ master, clock, externalTicks: true });
    const base = (await new MockMarketDataAdapter({ master }).getQuote(
      EQUITY?.symbol ?? '',
    )) as Quote;
    await redis.hset(
      `${prefix}last:${String(SHARD)}`,
      String(TOKEN),
      JSON.stringify({ ...base, ltp: 1_400_00, ts: AT }),
    );
    const app = h.app({
      deps: {
        clock,
        market,
        matcherMode: 'worker',
        quoteStreams: {
          url: `redis://${String(redis.options.host)}:${String(redis.options.port)}/${String(redis.options.db ?? 0)}`,
          shards: SHARDS,
          streamKey: (s) => `${prefix}ticks:${String(s)}`,
          snapshotKey: (s) => `${prefix}last:${String(s)}`,
          commandsKey: (s) => `${prefix}commands:${String(s)}`,
          fillsKey: (s) => `${prefix}fills:${String(s)}`,
          blockMs: 100,
          log: silent,
        },
      },
    });
    app.addHook('onClose', () => market.dispose());
    await app.ready();

    const resting: { userId: string; orderId: string }[] = [];
    for (let i = 0; i < USERS; i += 1) {
      const user = await login(app, i);
      const placed = await app.inject({
        method: 'POST',
        url: routes.orderPlace.path,
        headers: { authorization: `Bearer ${user.access}`, 'x-csrf-token': 'bearer' },
        remoteAddress: user.remoteAddress,
        payload: {
          token: TOKEN,
          side: 'BUY',
          type: 'LIMIT',
          price: 1_390_00,
          product: 'DELIVERY',
          qty: 1,
        },
      });
      expect(placed.statusCode, placed.body).toBe(200);
      resting.push({ userId: user.userId, orderId: (placed.json() as Order).id });
    }

    const sentAt = new Map<string, number>();
    const tookMs = new Map<string, number>();
    const waiting = new Set<() => void>();
    app.deps.orders.onOrderUpdate((_userId, order) => {
      const at = sentAt.get(order.id);
      if (order.status !== 'EXECUTED' || at === undefined) return;
      tookMs.set(order.id, performance.now() - at);
      sentAt.delete(order.id);
      for (const wake of waiting) wake();
    });
    const committed = (orders: readonly { orderId: string }[]) =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (orders.every(({ orderId }) => tookMs.has(orderId))) {
            waiting.delete(check);
            resolve();
          }
        };
        waiting.add(check);
        check();
      });
    const request = ({ userId, orderId }: { userId: string; orderId: string }) => {
      const fill: MatcherFill = {
        v: 1,
        userId,
        token: TOKEN,
        ltp: 1_385_00,
        ts: AT,
        orderIds: [orderId],
        stopIds: [],
      };
      return ['fill', JSON.stringify(fill)] as const;
    };
    const key = `${prefix}fills:${String(SHARD)}`;
    const stats = (orders: readonly { orderId: string }[]) => {
      const values = orders.map(({ orderId }) => tookMs.get(orderId) ?? Number.NaN);
      return {
        p50: percentile(values, 50),
        p95: percentile(values, 95),
        p99: percentile(values, 99),
        max: percentile(values, 100),
      };
    };

    // Steady: one crossing tick every RATE-th of a second, as fills arrive in a trading day.
    const steady = resting.slice(0, Math.ceil(USERS / 2));
    for (const order of steady) {
      sentAt.set(order.orderId, performance.now());
      await redis.xadd(key, '*', ...request(order));
      await new Promise((resolve) => setTimeout(resolve, 1_000 / RATE));
    }
    await committed(steady);

    // Burst: one tick that crosses every remaining order at once, sent in one pipeline.
    const burst = resting.slice(steady.length);
    const pipeline = redis.pipeline();
    const started = performance.now();
    for (const order of burst) {
      sentAt.set(order.orderId, started);
      pipeline.xadd(key, '*', ...request(order));
    }
    await pipeline.exec();
    await committed(burst);
    const burstMs = performance.now() - started;

    const result = {
      steady: { requests: steady.length, perSecond: RATE, ...stats(steady) },
      burst: {
        requests: burst.length,
        ...stats(burst),
        commitsPerSecond: Math.round((burst.length / burstMs) * 1_000),
      },
    };
    process.stdout.write(`matcher fill commit latency ${JSON.stringify(result)}\n`);
    expect(result.steady.p95).toBeLessThan(100);
  }, 120_000);
});
