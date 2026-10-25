import { OrderBook } from '@nthstock/paperEngine';
import { shardOf } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import {
  heldUsers,
  reconcileBooks,
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
  const reconcile = (snapshot: LiveOrderSnapshot) =>
    reconcileBooks({ snapshot, shard: 1, shards: SHARDS, books, book });
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
