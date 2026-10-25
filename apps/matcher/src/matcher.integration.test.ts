import {
  MATCHER_COMMAND_VERSION,
  MatcherFill,
  TICK_BATCH_VERSION,
  type Quote,
} from '@nthstock/contracts';
import { startLease, type Lease } from '@nthstock/marketData';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createFillWriter } from './fills.js';
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
      commands: {
        client: new Redis(server?.url ?? '', { maxRetriesPerRequest: null }),
        commandsKey: () => `${prefix}:commands`,
      },
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

  it('applies order commands from the stream on every process, before the ticks after them', async () => {
    const prefix = uniqueChannel('matcher');
    const clock = { now: 0 };
    const first = await boot(prefix, 'first', clock);
    const second = await boot(prefix, 'second', clock);
    const command = {
      v: MATCHER_COMMAND_VERSION,
      type: 'ADD',
      token: 2,
      version: 1,
      orderId: 'o2',
      userId: 'u2',
      side: 'BUY',
      price: 50_00,
    };
    await redis.xadd(`${prefix}:commands`, '*', 'command', JSON.stringify(command));
    // A malformed entry is skipped, not fatal.
    await redis.xadd(`${prefix}:commands`, '*', 'command', '{');
    await vi.waitFor(() => expect(first.matcher.book(2).hasOrder('o2')).toBe(true));
    await vi.waitFor(() => expect(second.matcher.stats().commands).toBe(1));

    await write(prefix, 1, [quote(2, 49_95)]);
    await vi.waitFor(() => expect(first.ticks).toHaveLength(1));
    expect(first.ticks[0]?.crossed.map((o) => o.orderId)).toEqual(['o2']);
    expect(second.ticks).toEqual([]);
  });

  it('sends a fill request for each user a tick crossed (NSTOCK-0367)', async () => {
    const prefix = uniqueChannel('matcher');
    const { matcher, ticks } = await boot(prefix, 'only', { now: 0 });
    const sendFills = createFillWriter({
      stream: redis,
      shard: 0,
      book: (token) => matcher.book(token),
      log: silent,
      fillsKey: () => `${prefix}:fills`,
    });
    await write(prefix, 1, [quote(1, 100_05)]);
    await vi.waitFor(() => expect(ticks).toHaveLength(1));
    await sendFills(ticks[0] as MatcherTick);
    const entries = await redis.xrange(`${prefix}:fills`, '-', '+');
    expect(entries.map(([, fields]) => MatcherFill.parse(JSON.parse(fields[1] ?? '')))).toEqual([
      {
        v: 1,
        userId: 'u1',
        token: 1,
        ltp: 100_05,
        ts: quote(1, 100_05).ts,
        orderIds: ['o1'],
        stopIds: [],
      },
    ]);
  });
});
