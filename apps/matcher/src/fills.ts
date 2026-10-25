import {
  MATCHER_FILLS_MAXLEN,
  MATCHER_FILL_MAX_IDS,
  MATCHER_FILL_VERSION,
  matcherFillsKey,
  type MatcherFill,
} from '@nthstock/contracts';
import type { OrderBook } from '@nthstock/paperEngine';
import type { MatcherLog, MatcherTick } from './matcher.js';

/** The one Redis call the fill writer makes; an ioredis client fits it. */
export type FillStream = {
  xadd(
    key: string,
    maxlen: 'MAXLEN',
    approximate: '~',
    count: number,
    id: '*',
    field: 'fill',
    value: string,
  ): Promise<unknown>;
};

/**
 * The fill requests for one tick (ADR 0013): one per user with an order that crossed or a stop
 * that triggered. A stop that only moved needs no request: the engine steps it on the next fill
 * or read, by the same rule.
 */
export function fillsFor(tick: MatcherTick): MatcherFill[] {
  const byUser = new Map<string, MatcherFill>();
  const entry = (userId: string) => {
    let fill = byUser.get(userId);
    if (!fill) {
      fill = {
        v: MATCHER_FILL_VERSION,
        userId,
        token: tick.token,
        ltp: tick.ltp,
        ts: tick.ts,
        orderIds: [],
        stopIds: [],
      };
      byUser.set(userId, fill);
    }
    return fill;
  };
  // The ids are for the logs and the engine re-checks every order and stop, so a user with more
  // than the contract allows in one tick still gets one request, naming the first ones.
  for (const order of tick.crossed) {
    const { orderIds } = entry(order.userId);
    if (orderIds.length < MATCHER_FILL_MAX_IDS) orderIds.push(order.orderId);
  }
  for (const stop of tick.triggered) {
    const { stopIds } = entry(stop.userId);
    if (stopIds.length < MATCHER_FILL_MAX_IDS) stopIds.push(stop.stopId);
  }
  return [...byUser.values()];
}

/**
 * Sends each tick's fill requests to the shard's fill stream (NSTOCK-0367), where apps/api commits
 * them. The orders and stops of a request that could not be sent go back on their book at the same
 * version (a triggered stop as TRAILING, where the tick left its stop), so the next tick that
 * crosses them asks again; the reconcile loop would restore them too, a minute later at worst. The
 * first failure of an outage is logged per user with the reason and the ids, and the recovery
 * with how many requests failed meanwhile.
 */
export function createFillWriter(options: {
  stream: FillStream;
  shard: number;
  book: (token: number) => OrderBook;
  log: MatcherLog;
  /** Tests pass their own key. */
  fillsKey?: (shard: number) => string;
}): (tick: MatcherTick) => Promise<void> {
  const { stream, shard, book, log } = options;
  const key = (options.fillsKey ?? matcherFillsKey)(shard);
  let failing = false;
  let failedSends = 0;
  return async (tick) => {
    const fills = fillsFor(tick);
    if (fills.length === 0) return;
    const sent = await Promise.allSettled(
      fills.map((fill) =>
        stream.xadd(key, 'MAXLEN', '~', MATCHER_FILLS_MAXLEN, '*', 'fill', JSON.stringify(fill)),
      ),
    );
    const failed = new Set<string>();
    sent.forEach((result, i) => {
      const fill = fills[i];
      if (result.status === 'fulfilled' || fill === undefined) return;
      failed.add(fill.userId);
      if (!failing) {
        log.warn('Sending a matcher fill failed', {
          shard,
          token: tick.token,
          userId: fill.userId,
          orderIds: fill.orderIds,
          stopIds: fill.stopIds,
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
    if (failed.size === 0) {
      if (failing) log.info('Sending matcher fills recovered', { shard, failedSends });
      failing = false;
      failedSends = 0;
      return;
    }
    failing = true;
    failedSends += failed.size;
    const held = book(tick.token);
    for (const order of tick.crossed) {
      if (failed.has(order.userId)) held.restoreOrder(order);
    }
    for (const stop of tick.triggered) {
      if (failed.has(stop.userId)) {
        held.restoreStop({ ...stop, state: { ...stop.state, status: 'TRAILING' } });
      }
    }
  };
}
