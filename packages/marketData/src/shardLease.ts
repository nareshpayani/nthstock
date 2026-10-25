/**
 * The Redis calls the lease makes, so this package needs no Redis client of its own: an ioredis
 * client fits it.
 */
export type LeaseClient = {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  set(key: string, value: string, px: 'PX', ttlMs: number, nx: 'NX'): Promise<string | null>;
};

type IntervalGlobal = {
  setInterval(run: () => void, ms: number): { unref?: () => void } | number;
  clearInterval(handle: unknown): void;
};

/** This package has no DOM or Node types, so the timers are looked up on `globalThis`. */
const timers = globalThis as unknown as IntervalGlobal;

/** Extends the lease only while `holder` still owns it. */
const RENEW = `if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0`;

/** Gives the lease up only while `holder` still owns it. */
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

export type LeaseLog = {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
};

export type LeaseOptions = {
  redis: LeaseClient;
  /** For example `lease:quotes:0` or `lease:matcher:0` (spec market-data-and-matching §3). */
  key: string;
  /** Who this process is; unique per process. */
  holder: string;
  ttlMs: number;
  renewMs: number;
  log: LeaseLog;
  /** Milliseconds now; default `Date.now`. */
  now?: () => number;
  setInterval?: (run: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

export type Lease = {
  /**
   * Whether this process may write now: it took or renewed the lease within the TTL. A renewal
   * that fails (Redis unreachable) does not end the lease at once, but it ends when the TTL would
   * have, so two writers never overlap.
   */
  isHeld(): boolean;
  /** One acquire-or-renew round; the timer calls it, and tests call it directly. */
  tick(): Promise<void>;
  /** Stops renewing and gives the lease up, so a waiting process takes over at once. */
  stop(): Promise<void>;
};

/**
 * One writer per shard (spec market-data-and-matching §3): `SET key holder NX PX ttl` takes the
 * lease, and the holder renews it every `renewMs`. apps/quotes and apps/matcher both hold one. A second process for the same shard keeps
 * trying and takes over when the holder stops or dies (after at most the TTL).
 */
export function startLease(options: LeaseOptions): Lease {
  const { redis, key, holder, ttlMs, renewMs, log } = options;
  const now = options.now ?? Date.now;
  const schedule =
    options.setInterval ??
    ((run, ms) => {
      const handle = timers.setInterval(run, ms);
      // Node: a lease timer alone does not keep the process alive.
      if (typeof handle === 'object') handle.unref?.();
      return handle;
    });
  const cancel = options.clearInterval ?? ((handle) => timers.clearInterval(handle));
  /** When the lease was last taken or renewed, or null while another process holds it. */
  let confirmedAt: number | null = null;
  let stopped = false;
  let running: Promise<void> | null = null;

  const isHeld = () => confirmedAt !== null && now() - confirmedAt < ttlMs;

  async function round(): Promise<void> {
    const startedAt = now();
    try {
      if (confirmedAt !== null) {
        const renewed = await redis.eval(RENEW, 1, key, holder, String(ttlMs));
        if (renewed === 1) {
          confirmedAt = startedAt;
          return;
        }
        confirmedAt = null;
        log.warn('lease lost', { key });
      }
      const taken = await redis.set(key, holder, 'PX', ttlMs, 'NX');
      if (taken === 'OK') {
        confirmedAt = startedAt;
        log.info('lease taken', { key });
      }
    } catch (error) {
      // Still held until the TTL runs out (isHeld), unless a later round confirms it.
      log.warn('lease round failed', { key, error: String(error) });
    }
  }

  const tick = () => {
    if (stopped) return Promise.resolve();
    running ??= round().finally(() => {
      running = null;
    });
    return running;
  };

  const handle = schedule(() => void tick(), renewMs);
  void tick();

  return {
    isHeld: () => !stopped && isHeld(),
    tick,
    async stop() {
      stopped = true;
      cancel(handle);
      await running;
      if (confirmedAt === null) return;
      confirmedAt = null;
      try {
        await redis.eval(RELEASE, 1, key, holder);
      } catch (error) {
        log.warn('lease release failed', { key, error: String(error) });
      }
    },
  };
}
