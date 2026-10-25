import type { Quote } from '@nthstock/contracts';
import type { StoredBar } from './store.js';

export const MINUTE_MS = 60_000;

/** The minute a quote belongs to, as minutes since the epoch: the floor of its `ts`. */
export const minuteOf = (quote: Pick<Quote, 'ts'>): number =>
  Math.floor(Date.parse(quote.ts) / MINUTE_MS);

/** The open time of a minute, as `StoredBar.bucket`. */
export const bucketOf = (minute: number): Date => new Date(minute * MINUTE_MS);

/** The quote fields a bar is folded from: `ltp` in paise, `volume` the cumulative day volume. */
export type BarQuote = Pick<Quote, 'token' | 'ltp' | 'volume' | 'ts'>;

/** The minute's closed bars: every token that ticked in it. */
export type ClosedMinute = { minute: number; bars: StoredBar[] };

export type MinuteAggregator = {
  /**
   * Folds a quote into the forming bar of its token. A quote of a later minute than the forming
   * one first closes the forming minute (stream time moved past it), which is returned. A quote of
   * a minute already closed is late: it adds to no bar and only moves the volume baseline forward.
   */
  add(quote: BarQuote): ClosedMinute | null;
  /**
   * Moves only the volume baseline: for quotes of minutes already written before a restart, which
   * must not form a bar again but which the next minute's volume is counted from.
   */
  observe(quote: BarQuote): void;
  /** Closes the forming minute (no tick has moved past it, but its time is up). */
  close(): ClosedMinute | null;
  /** Marks every minute up to `minute` closed, so their quotes count as late from now on. */
  closeThrough(minute: number): void;
  /** The forming minute, or null before the first quote or after `close()`. */
  formingMinute(): number | null;
  /** Every minute below this one is closed (null: nothing seen or closed yet). */
  closedBefore(): number | null;
};

/**
 * Folds one shard's quotes into 1-minute bars (spec market-data-and-matching §7.2). Pure: no I/O,
 * no clock; time is the quotes' own `ts`, so a replay of the same stream gives the same bars.
 *
 * A bar's volume is the shares traded in its minute, from the cumulative day volume: the last
 * cumulative in the minute minus the last one seen before it. The first cumulative a token has is
 * its baseline (it adds nothing), and a cumulative below the one before it starts a new session,
 * so it counts in full.
 */
export function createMinuteAggregator(
  options: { closedThrough?: number | null } = {},
): MinuteAggregator {
  /** The last cumulative volume per token, whatever minute it came in. */
  const lastCumulative = new Map<number, number>();
  const forming = new Map<number, StoredBar>();
  let formingAt: number | null = null;
  let floor: number | null = options.closedThrough ?? null;

  /** Shares traded since the token's last cumulative; also records this one. */
  const traded = (token: number, cumulative: number): number => {
    const before = lastCumulative.get(token);
    lastCumulative.set(token, cumulative);
    if (before === undefined) return 0;
    return cumulative >= before ? cumulative - before : cumulative;
  };

  const closeForming = (): ClosedMinute | null => {
    if (formingAt === null) return null;
    const closed = { minute: formingAt, bars: [...forming.values()] };
    floor = floor === null ? formingAt : Math.max(floor, formingAt);
    forming.clear();
    formingAt = null;
    return closed;
  };

  const aggregator: MinuteAggregator = {
    add(quote) {
      const minute = minuteOf(quote);
      if ((floor !== null && minute <= floor) || (formingAt !== null && minute < formingAt)) {
        // Late: never lower the baseline, which a stray old tick would turn into a new session.
        const before = lastCumulative.get(quote.token);
        if (before === undefined || quote.volume >= before) {
          lastCumulative.set(quote.token, quote.volume);
        }
        return null;
      }
      const closed = formingAt !== null && minute > formingAt ? closeForming() : null;
      formingAt = minute;
      const volume = traded(quote.token, quote.volume);
      const bar = forming.get(quote.token);
      if (bar) {
        bar.high = Math.max(bar.high, quote.ltp);
        bar.low = Math.min(bar.low, quote.ltp);
        bar.close = quote.ltp;
        bar.volume += volume;
      } else {
        forming.set(quote.token, {
          token: quote.token,
          bucket: bucketOf(minute),
          open: quote.ltp,
          high: quote.ltp,
          low: quote.ltp,
          close: quote.ltp,
          volume,
        });
      }
      return closed;
    },
    observe(quote) {
      lastCumulative.set(quote.token, quote.volume);
    },
    close: closeForming,
    closeThrough(minute) {
      if (formingAt !== null && formingAt <= minute) {
        throw new Error('closeThrough would drop the forming minute; close() it first');
      }
      floor = floor === null ? minute : Math.max(floor, minute);
    },
    formingMinute: () => formingAt,
    closedBefore: () => formingAt ?? (floor === null ? null : floor + 1),
  };
  return aggregator;
}
