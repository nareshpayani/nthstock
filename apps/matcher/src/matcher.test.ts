import type { Quote } from '@nthstock/contracts';
import type { TickStreamClient, TickStreamFollowerOptions } from '@nthstock/marketData';
import { describe, expect, it } from 'vitest';
import { startMatcher, type MatcherTick } from './matcher.js';
import { CLOSED_TS, quote } from './test/quotes.js';

const silent = { info: () => undefined, warn: () => undefined };

/** A matcher whose tick stream the test drives by hand. */
function harness(options: { leader?: boolean; alwaysOpen?: boolean } = {}) {
  let push: (quotes: readonly Quote[]) => void = () => undefined;
  let followed: TickStreamFollowerOptions | undefined;
  let closed = false;
  const state = { leader: options.leader ?? true };
  const ticks: MatcherTick[] = [];
  const matcher = startMatcher({
    client: {} as TickStreamClient,
    shard: 3,
    holdsLease: () => state.leader,
    alwaysOpen: options.alwaysOpen ?? false,
    onTick: (tick) => ticks.push(tick),
    log: silent,
    follow: (followOptions) => {
      followed = followOptions;
      push = followOptions.onQuotes;
      return {
        ready: () => Promise.resolve(),
        close: () => {
          closed = true;
          return Promise.resolve();
        },
      };
    },
  });
  return {
    matcher,
    ticks,
    state,
    push: (...quotes: Quote[]) => push(quotes),
    followed: () => followed,
    closed: () => closed,
  };
}

describe('startMatcher (NSTOCK-0364)', () => {
  it("reads only its own shard's stream and snapshot", async () => {
    const { matcher, followed, closed } = harness();
    await matcher.ready();
    expect(followed()?.shards).toBe(1);
    expect(followed()?.streamKey?.(0)).toBe('nthstock:ticks:v1:3');
    expect(followed()?.snapshotKey?.(0)).toBe('nthstock:quotes:last:v1:3');
    await matcher.close();
    expect(closed()).toBe(true);
  });

  it('runs a tick through the instrument book and reports what it crossed', () => {
    const { matcher, ticks, push } = harness();
    const book = matcher.book(7);
    expect(matcher.book(7)).toBe(book);
    book.upsertOrder({ orderId: 'o1', userId: 'u1', version: 1, side: 'BUY', price: 100_00 });

    push(quote(7, 100_50), quote(8, 90_00));
    expect(ticks).toEqual([]);
    push(quote(7, 100_00));
    expect(ticks.map((t) => [t.symbol, t.ltp, t.crossed.map((o) => o.orderId)])).toEqual([
      ['SYM7', 100_00, ['o1']],
    ]);
    expect(matcher.stats()).toEqual({ ticks: 3, acted: 2 });
    expect([...matcher.books.keys()]).toEqual([7]);
  });

  it('acts only while it holds the lease, and only in market hours', () => {
    const { matcher, ticks, state, push } = harness({ leader: false });
    matcher
      .book(7)
      .upsertOrder({ orderId: 'o1', userId: 'u1', version: 1, side: 'SELL', price: 100_00 });

    push(quote(7, 101_00));
    expect(ticks).toEqual([]);
    state.leader = true;
    push(quote(7, 101_00, CLOSED_TS));
    expect(ticks).toEqual([]);
    push(quote(7, 101_00));
    expect(ticks.map((t) => t.crossed.length)).toEqual([1]);
  });

  it('acts outside market hours with MOCK_MARKET_ALWAYS_OPEN', () => {
    const { matcher, ticks, push } = harness({ alwaysOpen: true });
    matcher
      .book(7)
      .upsertOrder({ orderId: 'o1', userId: 'u1', version: 1, side: 'SELL', price: 100_00 });
    push(quote(7, 101_00, CLOSED_TS));
    expect(ticks).toHaveLength(1);
  });
});
