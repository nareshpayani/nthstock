import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { startLease, type Lease } from './lease.js';
import {
  describeWithRedis,
  startTestRedis,
  uniqueChannel,
  type TestRedis,
} from './test/testRedis.js';

const silent = { info: () => undefined, warn: () => undefined };
const noTimer = { setInterval: () => 0, clearInterval: () => undefined };

describeWithRedis('shard lease on real Redis (integration)', () => {
  let server: TestRedis | undefined;
  let redis: Redis;
  const leases: Lease[] = [];

  beforeAll(async () => {
    server = await startTestRedis();
    redis = new Redis(server.url);
  }, 180_000);

  afterEach(async () => {
    for (const lease of leases.splice(0)) await lease.stop();
  });

  afterAll(async () => {
    await redis.quit();
    await server?.stop();
  });

  /** A lease on its own clock, renewed only when the test calls `tick`. */
  function lease(key: string, holder: string, clock: { now: number }) {
    const started = startLease({
      redis,
      key,
      holder,
      ttlMs: 5_000,
      renewMs: 2_000,
      log: silent,
      now: () => clock.now,
      ...noTimer,
    });
    leases.push(started);
    return started;
  }

  it('lets one of two processes write, and the other take over when it stops', async () => {
    const key = uniqueChannel('lease:quotes');
    const clock = { now: 0 };
    const first = lease(key, 'first', clock);
    await first.tick();
    const second = lease(key, 'second', clock);
    await second.tick();

    expect(first.isHeld()).toBe(true);
    expect(second.isHeld()).toBe(false);
    await first.tick();
    await second.tick();
    expect([first.isHeld(), second.isHeld()]).toEqual([true, false]);
    expect(await redis.get(key)).toBe('first');

    await first.stop();
    expect(first.isHeld()).toBe(false);
    await second.tick();
    expect(second.isHeld()).toBe(true);
    expect(await redis.get(key)).toBe('second');
  });

  it('hands over within the TTL when the holder dies without releasing', async () => {
    const key = uniqueChannel('lease:quotes');
    const clock = { now: 0 };
    const dead = lease(key, 'dead', clock);
    await dead.tick();
    const waiting = lease(key, 'waiting', clock);
    await waiting.tick();
    expect(waiting.isHeld()).toBe(false);

    // The holder stops renewing (a crash); Redis expires the key after the TTL.
    await redis.pexpire(key, 50);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await waiting.tick();
    expect(waiting.isHeld()).toBe(true);

    // The old holder's next renewal finds the lease gone and stops writing.
    clock.now = 2_000;
    await dead.tick();
    expect(dead.isHeld()).toBe(false);
    expect(await redis.get(key)).toBe('waiting');
  });

  it('stops writing once the TTL passes without a renewal it could confirm', async () => {
    const key = uniqueChannel('lease:quotes');
    const clock = { now: 0 };
    const holder = lease(key, 'holder', clock);
    await holder.tick();
    clock.now = 4_999;
    expect(holder.isHeld()).toBe(true);
    clock.now = 5_000;
    expect(holder.isHeld()).toBe(false);
  });

  it('keeps the lease of another holder when it stops', async () => {
    const key = uniqueChannel('lease:quotes');
    await redis.set(key, 'someone-else', 'PX', 5_000);
    const clock = { now: 0 };
    const late = lease(key, 'late', clock);
    await late.tick();
    await late.stop();
    expect(await redis.get(key)).toBe('someone-else');
  });

  it('renews on its own timer with the default clock', async () => {
    const key = uniqueChannel('lease:quotes');
    const started = startLease({
      redis,
      key,
      holder: 'timed',
      ttlMs: 1_000,
      renewMs: 20,
      log: silent,
    });
    leases.push(started);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(started.isHeld()).toBe(true);
    expect(await redis.pttl(key)).toBeGreaterThan(900);
  });

  it('logs a round it cannot run, and is not held', async () => {
    const offline = new Redis('redis://127.0.0.1:1', {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      lazyConnect: true,
    });
    const warnings: string[] = [];
    const started = startLease({
      redis: offline,
      key: uniqueChannel('lease:quotes'),
      holder: 'offline',
      ttlMs: 5_000,
      renewMs: 2_000,
      log: { info: () => undefined, warn: (message) => warnings.push(message) },
      ...noTimer,
    });
    await started.tick();
    expect(started.isHeld()).toBe(false);
    expect(warnings).toContain('lease round failed');
    await started.stop();
    offline.disconnect();
  });
});
