import { OrderBook } from '@nthstock/paperEngine';
import { shardOf } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import {
  heldUsers,
  reconcileBooks,
  RECONCILE_EVERY_MS,
  startReconcileLoop,
  type LiveOrder,
  type LiveOrderSnapshot,
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

    const result = reconcile({ orders: [live('o1', T1, 5)], versions: new Map([['u1', 5]]) });
    expect(result).toEqual({ added: 1, removed: 1 });
    expect([...book(T1).orders()].map((o) => [o.orderId, o.version])).toEqual([['o1', 5]]);
    expect(heldUsers(books)).toEqual(['u1']);
    // A second round with nothing new changes nothing.
    expect(reconcile({ orders: [live('o1', T1, 5)], versions: new Map([['u1', 5]]) })).toEqual({
      added: 0,
      removed: 0,
    });
  });

  it('keeps a command newer than the read', () => {
    const { book, reconcile } = harness();
    // A modify at version 7 arrived after Postgres was read at version 6.
    book(T1).upsertOrder({ orderId: 'o1', userId: 'u1', version: 7, side: 'BUY', price: 99_00 });
    book(T2).upsertOrder({ orderId: 'new', userId: 'u1', version: 7, side: 'BUY', price: 98_00 });
    reconcile({ orders: [live('o1', T1, 6)], versions: new Map([['u1', 6]]) });
    expect([...book(T1).orders()].map((o) => o.price)).toEqual([99_00]);
    expect(book(T2).hasOrder('new')).toBe(true);
  });

  it('keeps an order added after the read when Postgres no longer lists it', () => {
    for (const readVersion of [6, 7]) {
      const { book, reconcile } = harness();
      book(T1).upsertOrder({ orderId: 'o1', userId: 'u1', version: 7, side: 'BUY', price: 99_00 });
      const result = reconcile({ orders: [], versions: new Map([['u1', readVersion]]) });
      expect(result.removed).toBe(0);
      expect(book(T1).hasOrder('o1')).toBe(true);
    }
    // Once the read is newer than the order, the removal lands.
    const { book, reconcile } = harness();
    book(T1).upsertOrder({ orderId: 'o1', userId: 'u1', version: 7, side: 'BUY', price: 99_00 });
    expect(reconcile({ orders: [], versions: new Map([['u1', 8]]) }).removed).toBe(1);
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
      orders: [live('old', T1, 2, { shard: null }), live('elsewhere', OTHER, 2, { shard: null })],
      versions: new Map([['u1', 2]]),
    });
    expect(book(T1).hasOrder('old')).toBe(true);
    expect(books.has(OTHER)).toBe(false);
    expect(book(T2).hasOrder('erased')).toBe(false);
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
          return { orders: [], versions: new Map() };
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
          return { orders: [], versions: new Map() };
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
    await loop.run();
    expect(reads).toBe(2);
    tick();
    await loop.run();
    expect(reads).toBe(3);
    await loop.stop();
    expect(cleared).toEqual([handle]);
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
          return { orders: [live('o1', T1, 1)], versions: new Map() };
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
});
