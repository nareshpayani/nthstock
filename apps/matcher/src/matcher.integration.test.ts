import { TICK_BATCH_VERSION, type Quote } from '@nthstock/contracts';
import { startLease, type Lease } from '@nthstock/marketData';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { startMatcher, type Matcher, type MatcherTick } from './matcher.js';
import { quote } from './test/quotes.js';
import {
  describeWithRedis,
  startTestRedis,
  uniqueChannel,
  type TestRedis,
} from './test/testRedis.js';

// NSTOCK-0364 acceptance: two matchers for one shard on a real Redis; only the lease holder acts,
// and stopping it hands over to the other.

const silent = { info: () => undefined, warn: () => undefined };
const noTimer = { setInterval: () => 0, clearInterval: () => undefined };

describeWithRedis('two matchers on one shard (integration, NSTOCK-0364)', () => {
  let server: TestRedis | undefined;
  let redis: Redis;
  const running: { matcher: Matcher; lease: Lease }[] = [];

  beforeAll(async () => {
    server = await startTestRedis();
    redis = new Redis(server.url);
  }, 180_000);

  afterEach(async () => {
    for (const { matcher, lease } of running.splice(0)) {
      await matcher.close();
      await lease.stop();
    }
  });

  afterAll(async () => {
    await redis.quit();
    await server?.stop();
  });

  async function boot(prefix: string, holder: string, clock: { now: number }) {
    const lease = startLease({
      redis,
      key: `${prefix}:lease`,
      holder,
      ttlMs: 5_000,
      renewMs: 2_000,
      log: silent,
      now: () => clock.now,
      ...noTimer,
    });
    await lease.tick();
    const ticks: MatcherTick[] = [];
    const client = new Redis(server?.url ?? '', { maxRetriesPerRequest: null });
    const matcher = startMatcher({
      client,
      shard: 0,
      holdsLease: lease.isHeld,
      alwaysOpen: false,
      onTick: (tick) => ticks.push(tick),
      log: silent,
      blockMs: 100,
      streamKey: () => `${prefix}:ticks`,
      snapshotKey: () => `${prefix}:last`,
    });
    await matcher.ready();
    // The same resting SELL LIMIT on both books, as the reconcile loop will load it.
    matcher
      .book(1)
      .upsertOrder({ orderId: 'o1', userId: 'u1', version: 1, side: 'SELL', price: 100_00 });
    running.push({ matcher, lease });
    return { matcher, lease, ticks };
  }

  async function write(prefix: string, seq: number, quotes: Quote[]) {
    const batch = { v: TICK_BATCH_VERSION, shard: 0, seq, quotes };
    await redis.xadd(`${prefix}:ticks`, '*', 'batch', JSON.stringify(batch));
  }

  it('lets only the lease holder fill, and hands over when it stops', async () => {
    const prefix = uniqueChannel('matcher');
    const clock = { now: 0 };
    const first = await boot(prefix, 'first', clock);
    const second = await boot(prefix, 'second', clock);
    expect([first.lease.isHeld(), second.lease.isHeld()]).toEqual([true, false]);

    await write(prefix, 1, [quote(1, 100_00)]);
    await vi.waitFor(() => expect(first.ticks).toHaveLength(1));
    // Both read the batch; the standby is current but does not act.
    await vi.waitFor(() => expect(second.matcher.stats().ticks).toBe(1));
    expect(second.ticks).toEqual([]);
    expect(first.ticks[0]?.crossed.map((o) => o.orderId)).toEqual(['o1']);

    await first.lease.stop();
    await second.lease.tick();
    expect(second.lease.isHeld()).toBe(true);
    await write(prefix, 2, [quote(1, 100_05)]);
    await vi.waitFor(() => expect(second.ticks).toHaveLength(1));
    expect(first.ticks).toHaveLength(1);
  });
});
