import type { BookOrder, BookStop, OrderBook } from '@nthstock/paperEngine';
import { shardOf } from '@nthstock/utils';
import type { MatcherLog } from './matcher.js';

/** A resting LIMIT order as Postgres holds it, at its account's version when it was read. */
export type LiveOrder = BookOrder & { token: number; shard: number | null };

/**
 * An ARMED or TRAILING trailing stop as Postgres holds it, at its account's version when it was
 * read: what `STOP_ADD` carries (NSTOCK-0368). `trailing_stops` has no shard column, so the read
 * returns every active stop and the reconcile keeps those whose token maps to its shard.
 */
export type LiveStop = BookStop & { token: number };

/** One consistent read of a shard's live orders and stops (spec market-data-and-matching §5.3). */
export type LiveOrderSnapshot = {
  /** OPEN LIMIT orders whose shard is this one, or null (rows from before the column). */
  orders: readonly LiveOrder[];
  /** ARMED and TRAILING stops, on any shard. */
  stops: readonly LiveStop[];
  /** The account version of each user asked about, read in the same snapshot. */
  versions: ReadonlyMap<string, number>;
};

export type LiveOrderSource = {
  /**
   * The shard's live orders, the active stops, and the account versions of `userIds` (the users
   * whose orders or stops the books hold), from one snapshot. A user with no account (erased) is
   * left out of `versions`.
   */
  read(shard: number, userIds: readonly string[]): Promise<LiveOrderSnapshot>;
};

export type ReconcileResult = {
  added: number;
  removed: number;
  stopsAdded: number;
  stopsRemoved: number;
};

/**
 * Brings the books in step with Postgres, the truth (NSTOCK-0366). Each live order and active
 * stop is upserted at its account's version, so it lands only when that is newer than what the
 * book holds: a command that arrived after the read is kept. An order a tick crossed, or a stop a
 * tick triggered, is put back when Postgres still has it live at the same version: its fill
 * request was lost (NSTOCK-0367). An order or stop on a book that Postgres no longer has live is
 * taken off at its user's version, again only when that is newer. Order rows with a null shard,
 * and all stops, are kept when their token maps to this shard.
 */
export function reconcileBooks(options: {
  snapshot: LiveOrderSnapshot;
  shard: number;
  shards: number;
  books: ReadonlyMap<number, OrderBook>;
  book: (token: number) => OrderBook;
  /** The users whose versions were requested for the read; only these can be known erased. */
  asked: ReadonlySet<string>;
}): ReconcileResult {
  const { snapshot, shard, shards, books, book, asked } = options;
  const result: ReconcileResult = { added: 0, removed: 0, stopsAdded: 0, stopsRemoved: 0 };

  const liveOrders = new Set<string>();
  for (const order of snapshot.orders) {
    if (order.shard === null && shardOf(order.token, shards) !== shard) continue;
    liveOrders.add(order.orderId);
    const { orderId, userId, version, side, price } = order;
    const held = book(order.token);
    const had = held.hasOrder(orderId);
    // `restoreOrder` also puts back an order a tick crossed whose fill never committed.
    if (held.restoreOrder({ orderId, userId, version, side, price }) && !had) result.added += 1;
  }

  const liveStops = new Set<string>();
  for (const stop of snapshot.stops) {
    if (shardOf(stop.token, shards) !== shard) continue;
    liveStops.add(stop.stopId);
    const { stopId, userId, version, state } = stop;
    const held = book(stop.token);
    const had = held.hasStop(stopId);
    // `restoreStop` also puts back a stop a tick triggered whose fill never committed.
    if (held.restoreStop({ stopId, userId, version, state }) && !had) result.stopsAdded += 1;
  }

  /** The version to take a user's entry off at, or null to leave it for the next round. */
  const removalVersion = (userId: string): number | null => {
    const version = snapshot.versions.get(userId);
    if (version !== undefined) return version;
    // A user who joined the books after the read was asked was never looked up: leave them for
    // the next round. Only a user asked about and missing is erased, and nothing can be newer
    // than an erased account's removal.
    return asked.has(userId) ? Number.MAX_SAFE_INTEGER : null;
  };

  for (const held of books.values()) {
    for (const order of [...held.orders()]) {
      if (liveOrders.has(order.orderId)) continue;
      const version = removalVersion(order.userId);
      if (version !== null && held.removeOrder(order.orderId, version)) result.removed += 1;
    }
    for (const stop of [...held.stops()]) {
      if (liveStops.has(stop.stopId)) continue;
      const version = removalVersion(stop.userId);
      if (version !== null && held.removeStop(stop.stopId, version)) result.stopsRemoved += 1;
    }
  }
  return result;
}

/** The users whose orders or stops the books hold. */
export function heldUsers(books: ReadonlyMap<number, OrderBook>): string[] {
  const users = new Set<string>();
  for (const book of books.values()) {
    for (const order of book.orders()) users.add(order.userId);
    for (const stop of book.stops()) users.add(stop.userId);
  }
  return [...users];
}

export type ReconcileLoop = {
  /** Resolves after the first reconcile, or when the loop is stopped first. */
  ready(): Promise<void>;
  /** Runs one reconcile now (tests). */
  run(): Promise<ReconcileResult | null>;
  stop(): Promise<void>;
};

/** How often the matcher reconciles with Postgres (spec §5.3): a lost command lasts at most this. */
export const RECONCILE_EVERY_MS = 60_000;

/** A read still pending after this is abandoned, so one stalled connection cannot end the loop. */
export const RECONCILE_READ_TIMEOUT_MS = 15_000;

/** A failing reconcile is logged on its first round and then every this many (10 min at 60 s). */
export const RECONCILE_FAILURE_LOG_EVERY = 10;

function readWithin<T>(read: Promise<T>, ms: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`read did not settle in ${String(ms)} ms`)), ms);
  });
  return Promise.race([read, expired]).finally(() => clearTimeout(timeout));
}

/**
 * Reconciles on start and then every `everyMs`. A failed read is retried on the next round; the
 * books keep what the commands built meanwhile. An outage is logged on its first failed round and
 * every `RECONCILE_FAILURE_LOG_EVERY`th after it, with the count and the error's stack, so a
 * reconcile that stays down is not one line an hour ago.
 */
export function startReconcileLoop(options: {
  source: LiveOrderSource;
  shard: number;
  shards: number;
  books: ReadonlyMap<number, OrderBook>;
  book: (token: number) => OrderBook;
  log: MatcherLog;
  everyMs?: number;
  readTimeoutMs?: number;
  /** The first round waits for this (the command reader's first read). */
  after?: Promise<unknown>;
  /** Tests pass `null` to run rounds by hand. */
  timer?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval } | null;
}): ReconcileLoop {
  const { source, shard, shards, books, book, log } = options;
  let failures = 0;
  let stopped = false;
  let running: Promise<ReconcileResult | null> | null = null;

  async function round(): Promise<ReconcileResult | null> {
    try {
      const users = heldUsers(books);
      const snapshot = await readWithin(
        source.read(shard, users),
        options.readTimeoutMs ?? RECONCILE_READ_TIMEOUT_MS,
      );
      if (stopped) return null;
      const result = reconcileBooks({
        snapshot,
        shard,
        shards,
        books,
        book,
        asked: new Set(users),
      });
      if (failures > 0) log.info('Reconcile recovered', { shard, failures });
      failures = 0;
      // A repaired book means a command was lost; worth a line every time.
      if (result.added + result.removed + result.stopsAdded + result.stopsRemoved > 0)
        log.info('Reconcile repaired the books', { shard, ...result });
      return result;
    } catch (error) {
      failures += 1;
      if (failures === 1 || failures % RECONCILE_FAILURE_LOG_EVERY === 0) {
        log.warn('Reconcile failed', {
          shard,
          failures,
          error: error instanceof Error ? (error.stack ?? error.message) : String(error),
        });
      }
      return null;
    }
  }

  /** One round at a time: a slow read is not overlapped by the next. */
  const run = () => {
    running ??= round().finally(() => {
      running = null;
    });
    return running;
  };

  const first = (options.after ?? Promise.resolve()).then(run, run);
  const timer = options.timer === undefined ? { setInterval, clearInterval } : options.timer;
  const interval = timer?.setInterval(() => void run(), options.everyMs ?? RECONCILE_EVERY_MS);
  if (interval && typeof interval === 'object' && 'unref' in interval) interval.unref();

  return {
    ready: async () => {
      await first;
    },
    run,
    async stop() {
      stopped = true;
      if (interval !== undefined) timer?.clearInterval(interval);
      await running;
    },
  };
}
