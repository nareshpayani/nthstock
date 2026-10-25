import {
  MATCHER_FILLS_MAXLEN,
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
  for (const order of tick.crossed) entry(order.userId).orderIds.push(order.orderId);
  for (const stop of tick.triggered) entry(stop.userId).stopIds.push(stop.stopId);
  return [...byUser.values()];
}

/**
 * Sends each tick's fill requests to the shard's fill stream (NSTOCK-0367), where apps/api commits
 * them. An order whose request could not be sent goes back on its book at the same version, so the
 * next tick that crosses it asks again.
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
      const userId = fills[i]?.userId;
      if (result.status === 'rejected' && userId !== undefined) failed.add(userId);
    });
    if (failed.size === 0) {
      if (failing) log.info('Sending matcher fills recovered', { shard });
      failing = false;
      return;
    }
    if (!failing) log.warn('Sending matcher fills failed', { shard, users: failed.size });
    failing = true;
    for (const order of tick.crossed) {
      if (failed.has(order.userId)) book(tick.token).restoreOrder(order);
    }
  };
}
