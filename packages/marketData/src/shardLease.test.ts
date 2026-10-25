import { describe, expect, it, vi } from 'vitest';
import { startLease, type LeaseClient } from './shardLease.js';

// apps/quotes runs the same lease against a real Redis (`lease.integration.test.ts`); this covers
// its rules on an in-memory stand-in with a manual clock.

/** One key with a holder and an expiry, enough for SET NX PX and the two scripts. */
function fakeRedis(clock: { now: number }) {
  let holder: string | null = null;
  let expiresAt = 0;
  let down = false;
  const live = () => (holder !== null && clock.now < expiresAt ? holder : null);
  const client: LeaseClient = {
    eval: async (script, _keys, _key, who, ttl) => {
      if (down) throw new Error('connection refused');
      if (live() !== who) return 0;
      if (script.includes('pexpire')) expiresAt = clock.now + Number(ttl);
      else holder = null;
      return 1;
    },
    set: async (_key, value, _px, ttlMs) => {
      if (down) throw new Error('connection refused');
      if (live() !== null) return null;
      holder = value;
      expiresAt = clock.now + ttlMs;
      return 'OK';
    },
  };
  return {
    client,
    holder: live,
    expiresAt: () => expiresAt,
    setDown: (value: boolean) => {
      down = value;
    },
  };
}

const noTimer = { setInterval: () => 0, clearInterval: () => undefined };

function lease(
  redis: LeaseClient,
  holder: string,
  clock: { now: number },
  warnings: string[] = [],
) {
  return startLease({
    redis,
    key: 'lease:matcher:0',
    holder,
    ttlMs: 5_000,
    renewMs: 2_000,
    log: { info: () => undefined, warn: (message) => warnings.push(message) },
    now: () => clock.now,
    ...noTimer,
  });
}

describe('startLease (NSTOCK-0364)', () => {
  it('lets one holder act and hands over when it stops', async () => {
    const clock = { now: 0 };
    const redis = fakeRedis(clock);
    const first = lease(redis.client, 'first', clock);
    await first.tick();
    const second = lease(redis.client, 'second', clock);
    await second.tick();
    expect([first.isHeld(), second.isHeld()]).toEqual([true, false]);

    clock.now = 2_000;
    await first.tick();
    expect(first.isHeld()).toBe(true);
    await first.stop();
    expect(first.isHeld()).toBe(false);
    await second.tick();
    expect([second.isHeld(), redis.holder()]).toEqual([true, 'second']);
  });

  it('stops acting at the TTL when renewals fail, and notices a lost lease', async () => {
    const clock = { now: 0 };
    const redis = fakeRedis(clock);
    const warnings: string[] = [];
    const holder = lease(redis.client, 'holder', clock, warnings);
    await holder.tick();

    redis.setDown(true);
    clock.now = 2_000;
    await holder.tick();
    expect(holder.isHeld()).toBe(true);
    clock.now = 5_000;
    expect(holder.isHeld()).toBe(false);
    expect(warnings).toEqual(['lease round failed']);

    // Redis is back, but the key expired and another process took it.
    redis.setDown(false);
    const other = lease(redis.client, 'other', clock);
    await other.tick();
    await holder.tick();
    expect([holder.isHeld(), other.isHeld()]).toEqual([false, true]);
    expect(warnings).toEqual(['lease round failed', 'lease lost']);
  });

  it('renews on its own timer by default', async () => {
    const clock = { now: 0 };
    const redis = fakeRedis(clock);
    const started = startLease({
      redis: redis.client,
      key: 'lease:matcher:0',
      holder: 'timed',
      ttlMs: 1_000,
      renewMs: 10,
      log: { info: () => undefined, warn: () => undefined },
      now: () => clock.now,
    });
    await vi.waitFor(() => expect(started.isHeld()).toBe(true));
    // The timer renews it: the expiry follows the clock.
    clock.now = 900;
    await vi.waitFor(() => expect(redis.expiresAt()).toBe(1_900));
    await started.stop();
    expect(redis.holder()).toBeNull();
  });
});
