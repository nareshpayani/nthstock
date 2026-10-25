import { OrderBook } from '@nthstock/paperEngine';
import { shardOf } from '@nthstock/utils';
import { describe, expect, it, vi } from 'vitest';
import {
  heldUsers,
  reconcileBooks,
  RECONCILE_EVERY_MS,
  RECONCILE_FAILURE_LOG_EVERY,
  startReconcileLoop,
  type LiveOrder,
  type LiveOrderSnapshot,
  type LiveStop,
} from './reconcile.js';

const SHARDS = 4;
/** Tokens on shard 1 and on another shard. */
const tokens = Array.from({ length: 40 }, (_, i) => i + 1);
const MINE = tokens.filter((t) => shardOf(t, SHARDS) === 1);
const OTHER = tokens.find((t) => shardOf(t, SHARDS) !== 1) ?? 0;
const [T1 = 0, T2 = 0] = MINE;

const live = (orderId: string, token: number, version: number, extra: Partial<LiveOrder> = {}) => ({
  orderId,
  userId: 'u1',
  token,
  side: 'BUY' as const,
  price: 100_00,
  shard: 1,
  version,
  ...extra,
});

/** A TRAILING long stop at `stopPrice`, as Postgres holds it. */
const liveStop = (
  stopId: string,
  token: number,
  version: number,
  stopPrice = 90_00,
  userId = 'u1',
): LiveStop => ({
  stopId,
  userId,
  token,
  version,
  state: {
    status: 'TRAILING',
    direction: 'LONG',
    trail: { unit: 'AMOUNT', amount: 10_00 },
    activationPrice: null,
    watermarkPrice: stopPrice + 10_00,
    stopPrice,
  },
});

const stopPrices = (book: OrderBook) =>
  [...book.stops()].map((s) => [s.stopId, s.version, s.state.stopPrice]);

function harness() {
  const books = new Map<number, OrderBook>();
  const book = (token: number) => {
    let found = books.get(token);
    if (!found) {
      found = new OrderBook();
      books.set(token, found);
    }
    return found;
  };
  const reconcile = (snapshot: LiveOrderSnapshot, asked: readonly string[] = ['u1', 'u9']) =>
    reconcileBooks({ snapshot, shard: 1, shards: SHARDS, books, book, asked: new Set(asked) });
  return { books, book, reconcile };
}

describe('reconcileBooks (NSTOCK-0366)', () => {
  it('adds the live orders a lost ADD left out, and takes off what a lost CANCEL left in', () => {
    const { book, books, reconcile } = harness();
    book(T1).upsertOrder({
      orderId: 'gone',
      userId: 'u1',
      version: 2,
      side: 'SELL',
      price: 101_00,
    });

    const result = reconcile({
      stops: [],
      orders: [live('o1', T1, 5)],
      versions: new Map([['u1', 5]]),
    });
    expect(result).toEqual({ added: 1, removed: 1, stopsAdded: 0, stopsRemoved: 0 });
    expect([...book(T1).orders()].map((o) => [o.orderId, o.version])).toEqual([['o1', 5]]);
    expect(heldUsers(books)).toEqual(['u1']);
    // A second round with nothing new changes nothing.
    expect(
      reconcile({ stops: [], orders: [live('o1', T1, 5)], versions: new Map([['u1', 5]]) }),
    ).toEqual({
      added: 0,
      removed: 0,
      stopsAdded: 0,
      stopsRemoved: 0,
    });
  });

  it('restores a crossed order whose fill was lost, unless a newer user version removed it', () => {
    const order = { orderId: 'o1', userId: 'u1', version: 5, side: 'BUY' as const, price: 100_00 };
    // The order crossed and left the book, but Postgres still lists it open at the same version.
    const lost = harness();
    lost.book(T1).upsertOrder(order);
    expect(lost.book(T1).tick(100_00).crossed).toEqual([order]);
    expect(lost.book(T1).hasOrder('o1')).toBe(false);
    const result = lost.reconcile({
      stops: [],
      orders: [live('o1', T1, 5)],
      versions: new Map([['u1', 5]]),
    });
    expect(result).toEqual({ added: 1, removed: 0, stopsAdded: 0, stopsRemoved: 0 });
    expect(lost.book(T1).hasOrder('o1')).toBe(true);

    // A newer user version took the order off before the read: it stays off.
    const gone = harness();
    gone.book(T1).upsertOrder(order);
    gone.book(T1).tick(100_00);
    gone.book(T1).removeOrder('o1', 6);
    const none = gone.reconcile({ stops: [], orders: [], versions: new Map([['u1', 6]]) });
    expect(none).toEqual({ added: 0, removed: 0, stopsAdded: 0, stopsRemoved: 0 });
    expect(gone.book(T1).hasOrder('o1')).toBe(false);
  });

  it('keeps a command newer than the read', () => {
    const { book, reconcile } = harness();
    // A modify at version 7 arrived after Postgres was read at version 6.
    book(T1).upsertOrder({ orderId: 'o1', userId: 'u1', version: 7, side: 'BUY', price: 99_00 });
    book(T2).upsertOrder({ orderId: 'new', userId: 'u1', version: 7, side: 'BUY', price: 98_00 });
    reconcile({ stops: [], orders: [live('o1', T1, 6)], versions: new Map([['u1', 6]]) });
    expect([...book(T1).orders()].map((o) => o.price)).toEqual([99_00]);
    expect(book(T2).hasOrder('new')).toBe(true);
  });

  it('keeps an order added after the read when Postgres no longer lists it', () => {
    for (const readVersion of [6, 7]) {
      const { book, reconcile } = harness();
      book(T1).upsertOrder({ orderId: 'o1', userId: 'u1', version: 7, side: 'BUY', price: 99_00 });
      const result = reconcile({ stops: [], orders: [], versions: new Map([['u1', readVersion]]) });
      expect(result.removed).toBe(0);
      expect(book(T1).hasOrder('o1')).toBe(true);
    }
    // Once the read is newer than the order, the removal lands.
    const { book, reconcile } = harness();
    book(T1).upsertOrder({ orderId: 'o1', userId: 'u1', version: 7, side: 'BUY', price: 99_00 });
    expect(reconcile({ stops: [], orders: [], versions: new Map([['u1', 8]]) }).removed).toBe(1);
    expect(book(T1).hasOrder('o1')).toBe(false);
  });

  it("keeps rows with no shard by their token, and takes off an erased account's orders", () => {
    const { book, books, reconcile } = harness();
    book(T2).upsertOrder({
      orderId: 'erased',
      userId: 'u9',
      version: 3,
      side: 'BUY',
      price: 90_00,
    });
    reconcile({
      stops: [],
      orders: [live('old', T1, 2, { shard: null }), live('elsewhere', OTHER, 2, { shard: null })],
      versions: new Map([['u1', 2]]),
    });
    expect(book(T1).hasOrder('old')).toBe(true);
    expect(books.has(OTHER)).toBe(false);
    expect(book(T2).hasOrder('erased')).toBe(false);
  });
});

describe('reconcileBooks: trailing stops (NSTOCK-0368)', () => {
  it('adds an active stop a lost STOP_ADD left out, only on this shard', () => {
    const { book, books, reconcile } = harness();
    const result = reconcile({
      orders: [],
      stops: [liveStop('t1', T1, 4), liveStop('elsewhere', OTHER, 4)],
      versions: new Map([['u1', 4]]),
    });
    expect(result).toEqual({ added: 0, removed: 0, stopsAdded: 1, stopsRemoved: 0 });
    expect(stopPrices(book(T1))).toEqual([['t1', 4, 90_00]]);
    expect(books.has(OTHER)).toBe(false);
    // A user with only stops on the books is asked about on the next round.
    expect(heldUsers(books)).toEqual(['u1']);
    // The stop rests on its price: a tick through it triggers it.
    expect(
      book(T1)
        .tick(90_00)
        .triggered.map((s) => s.stopId),
    ).toEqual(['t1']);
  });

  it('takes off a stop a lost STOP_CANCEL left in, and an erased account’s stops', () => {
    const { book, reconcile } = harness();
    book(T1).upsertStop(liveStop('t1', T1, 3));
    book(T2).upsertStop(liveStop('t9', T2, 2, 90_00, 'u9'));
    const result = reconcile({ orders: [], stops: [], versions: new Map([['u1', 5]]) });
    expect(result).toEqual({ added: 0, removed: 0, stopsAdded: 0, stopsRemoved: 2 });
    expect(book(T1).hasStop('t1')).toBe(false);
    expect(book(T2).hasStop('t9')).toBe(false);
    expect(book(T1).tick(80_00).triggered).toEqual([]);
  });

  it('keeps a stop command newer than the read', () => {
    const { book, reconcile } = harness();
    // A STOP_ADD at version 7 moved t1 to 95 and placed t2 after Postgres was read at version 6.
    book(T1).upsertStop(liveStop('t1', T1, 7, 95_00));
    book(T2).upsertStop(liveStop('t2', T2, 7));
    const result = reconcile({
      orders: [],
      stops: [liveStop('t1', T1, 6, 90_00)],
      versions: new Map([['u1', 6]]),
    });
    expect(result).toEqual({ added: 0, removed: 0, stopsAdded: 0, stopsRemoved: 0 });
    expect(stopPrices(book(T1))).toEqual([['t1', 7, 95_00]]);
    expect(book(T2).hasStop('t2')).toBe(true);
    // Once the read is newer, the missing stop comes off.
    expect(reconcile({ orders: [], stops: [], versions: new Map([['u1', 8]]) }).stopsRemoved).toBe(
      2,
    );
  });

  it('restores a triggered stop whose fill was lost at the same version, not at a newer one', () => {
    // The stop triggered and left the book, but Postgres still lists it active at version 5.
    const lost = harness();
    lost.book(T1).upsertStop(liveStop('t1', T1, 5));
    expect(
      lost
        .book(T1)
        .tick(89_00)
        .triggered.map((s) => s.stopId),
    ).toEqual(['t1']);
    expect(lost.book(T1).hasStop('t1')).toBe(false);
    const result = lost.reconcile({
      orders: [],
      stops: [liveStop('t1', T1, 5)],
      versions: new Map([['u1', 5]]),
    });
    expect(result).toEqual({ added: 0, removed: 0, stopsAdded: 1, stopsRemoved: 0 });
    expect(stopPrices(lost.book(T1))).toEqual([['t1', 5, 90_00]]);

    // A newer user version (the exit's commit) took it off before the read: it stays off.
    const filled = harness();
    filled.book(T1).upsertStop(liveStop('t1', T1, 5));
    filled.book(T1).tick(89_00);
    filled.book(T1).removeStop('t1', 6);
    const none = filled.reconcile({
      orders: [],
      stops: [liveStop('t1', T1, 5)],
      versions: new Map([['u1', 6]]),
    });
    expect(none).toEqual({ added: 0, removed: 0, stopsAdded: 0, stopsRemoved: 0 });
    expect(filled.book(T1).hasStop('t1')).toBe(false);
  });

  it('leaves a same-version stop that ticks ratcheted past what Postgres holds (NSTOCK-0388)', () => {
    const { book, reconcile } = harness();
    // Placed at version 5 with its stop at 90; ticks to 110 and 120 ratchet it to 110.
    book(T1).upsertStop(liveStop('t1', T1, 5));
    expect(book(T1).tick(110_00).moved).toHaveLength(1);
    expect(book(T1).tick(120_00).moved).toHaveLength(1);
    expect(stopPrices(book(T1))).toEqual([['t1', 5, 110_00]]);

    // Postgres still has the placement's state: no commit wrote the ratchet yet.
    const result = reconcile({
      orders: [],
      stops: [liveStop('t1', T1, 5)],
      versions: new Map([['u1', 5]]),
    });
    expect(result).toEqual({ added: 0, removed: 0, stopsAdded: 0, stopsRemoved: 0 });
    expect(stopPrices(book(T1))).toEqual([['t1', 5, 110_00]]);
    expect([...book(T1).stops()][0]?.state.watermarkPrice).toBe(120_00);
    // So it triggers where the ticks left it, not at the older 90.
    expect(
      book(T1)
        .tick(109_00)
        .triggered.map((s) => s.stopId),
    ).toEqual(['t1']);
  });
});

describe('startReconcileLoop (NSTOCK-0366)', () => {
  it('does not tombstone an order from a user who joined the books while the read was pending', async () => {
    const { books, book } = harness();
    let finish: () => void = () => undefined;
    const loop = startReconcileLoop({
      source: {
        read: async () => {
          await new Promise<void>((resolve) => (finish = resolve));
          return { stops: [], orders: [], versions: new Map() };
        },
      },
      shard: 1,
      shards: SHARDS,
      books,
      book,
      log: { info: () => undefined, warn: () => undefined },
      timer: null,
    });
    await Promise.resolve();
    // An ADD for a user the books did not hold when the read began.
    book(T1).upsertOrder({ orderId: 'n1', userId: 'u7', version: 1, side: 'BUY', price: 90_00 });
    finish();
    await loop.ready();
    expect(book(T1).hasOrder('n1')).toBe(true);
    // It can still be cancelled afterwards.
    expect(book(T1).removeOrder('n1', 2)).toBe(true);
    await loop.stop();
  });

  it('reconciles every 60 s on the timer and clears it on stop', async () => {
    const { books, book } = harness();
    let reads = 0;
    let tick: () => void = () => undefined;
    const set: number[] = [];
    const cleared: unknown[] = [];
    const handle = { id: 'timer' };
    const loop = startReconcileLoop({
      source: {
        read: async () => {
          reads += 1;
          return { stops: [], orders: [], versions: new Map() };
        },
      },
      shard: 1,
      shards: SHARDS,
      books,
      book,
      log: { info: () => undefined, warn: () => undefined },
      timer: {
        setInterval: ((fn: () => void, ms: number) => {
          tick = fn;
          set.push(ms);
          return handle;
        }) as unknown as typeof setInterval,
        clearInterval: ((h: unknown) => void cleared.push(h)) as unknown as typeof clearInterval,
      },
    });
    await loop.ready();
    expect(set).toEqual([60_000]);
    expect(RECONCILE_EVERY_MS).toBe(60_000);
    expect(reads).toBe(1);
    tick();
    await vi.waitFor(() => expect(reads).toBe(2));
    // Let that round finish: a tick during a round is skipped by design.
    await new Promise<void>((resolve) => setImmediate(resolve));
    tick();
    await vi.waitFor(() => expect(reads).toBe(3));
    await loop.stop();
    expect(cleared).toEqual([handle]);
  });

  it('fires on the real timer by default, and stop ends it', async () => {
    vi.useFakeTimers();
    try {
      const { books, book } = harness();
      let reads = 0;
      const loop = startReconcileLoop({
        source: {
          read: async () => {
            reads += 1;
            return { stops: [], orders: [], versions: new Map() };
          },
        },
        shard: 1,
        shards: SHARDS,
        books,
        book,
        log: { info: () => undefined, warn: () => undefined },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(reads).toBe(1);
      await vi.advanceTimersByTimeAsync(RECONCILE_EVERY_MS);
      expect(reads).toBe(2);
      await loop.stop();
      await vi.advanceTimersByTimeAsync(RECONCILE_EVERY_MS * 3);
      expect(reads).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('abandons a hung read so the next round and stop still run', async () => {
    vi.useFakeTimers();
    try {
      const { books, book } = harness();
      let reads = 0;
      const warnings: string[] = [];
      const loop = startReconcileLoop({
        source: {
          read: () => {
            reads += 1;
            return reads === 1
              ? new Promise<never>(() => undefined)
              : Promise.resolve({ stops: [], orders: [], versions: new Map() });
          },
        },
        shard: 1,
        shards: SHARDS,
        books,
        book,
        readTimeoutMs: 1_000,
        log: { info: () => undefined, warn: (m) => warnings.push(m) },
        timer: null,
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await loop.ready();
      expect(warnings).toEqual(['Reconcile failed']);
      await loop.run();
      expect(reads).toBe(2);
      await expect(loop.stop()).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs on start, one round at a time, and logs a failing read once', async () => {
    const { books, book } = harness();
    let calls = 0;
    let fail = false;
    let release: () => void = () => undefined;
    const lines: string[] = [];
    const loop = startReconcileLoop({
      source: {
        read: async () => {
          calls += 1;
          if (fail) throw new Error('connection refused');
          if (calls === 2) await new Promise<void>((resolve) => (release = resolve));
          return { stops: [], orders: [live('o1', T1, 1)], versions: new Map() };
        },
      },
      shard: 1,
      shards: SHARDS,
      books,
      book,
      log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) },
      timer: null,
    });
    await loop.ready();
    expect(book(T1).hasOrder('o1')).toBe(true);
    expect(lines).toEqual(['Reconcile repaired the books']);

    const slow = loop.run();
    const overlapping = loop.run();
    release();
    await Promise.all([slow, overlapping]);
    expect(calls).toBe(2);

    fail = true;
    await loop.run();
    await loop.run();
    fail = false;
    await loop.run();
    expect(lines.slice(1)).toEqual(['Reconcile failed', 'Reconcile recovered']);
    await loop.stop();
  });

  it('logs every Nth failed round of an outage with the count and stack (NSTOCK-0388)', async () => {
    const { books, book } = harness();
    let fail = true;
    const lines: { message: string; fields?: Record<string, unknown> }[] = [];
    const record = (message: string, fields?: Record<string, unknown>) =>
      lines.push({ message, ...(fields ? { fields } : {}) });
    const loop = startReconcileLoop({
      source: {
        read: async () => {
          if (fail) throw new Error('connection refused');
          return { stops: [], orders: [], versions: new Map() };
        },
      },
      shard: 1,
      shards: SHARDS,
      books,
      book,
      log: { info: record, warn: record },
      timer: null,
    });
    await loop.ready();
    for (let round = 2; round <= 2 * RECONCILE_FAILURE_LOG_EVERY + 1; round += 1) await loop.run();
    fail = false;
    await loop.run();

    expect(lines.map((line) => [line.message, line.fields?.['failures']])).toEqual([
      ['Reconcile failed', 1],
      ['Reconcile failed', RECONCILE_FAILURE_LOG_EVERY],
      ['Reconcile failed', 2 * RECONCILE_FAILURE_LOG_EVERY],
      ['Reconcile recovered', 2 * RECONCILE_FAILURE_LOG_EVERY + 1],
    ]);
    expect(String(lines[0]?.fields?.['error'])).toMatch(/^Error: connection refused\n\s+at /);
    await loop.stop();
  });
});
