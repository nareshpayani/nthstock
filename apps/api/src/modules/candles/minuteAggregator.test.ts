import { describe, expect, it } from 'vitest';
import { bucketOf, createMinuteAggregator, minuteOf, type BarQuote } from './minuteAggregator.js';

const T0 = Date.parse('2026-10-23T04:00:00.000Z');
const MINUTE0 = T0 / 60_000;

/** A quote `seconds` after 04:00 UTC. */
const q = (token: number, seconds: number, ltp: number, volume: number): BarQuote => ({
  token,
  ltp,
  volume,
  ts: new Date(T0 + seconds * 1000).toISOString(),
});

describe('minuteOf and bucketOf', () => {
  it('floors a quote to its minute and back to the open time', () => {
    expect(minuteOf(q(1, 59.999, 1, 0))).toBe(MINUTE0);
    expect(minuteOf(q(1, 60, 1, 0))).toBe(MINUTE0 + 1);
    expect(bucketOf(MINUTE0 + 1).toISOString()).toBe('2026-10-23T04:01:00.000Z');
  });
});

describe('createMinuteAggregator', () => {
  it('folds OHLC per token and closes the minute when stream time moves past it', () => {
    const aggregator = createMinuteAggregator();
    expect(aggregator.closedBefore()).toBeNull();
    expect(aggregator.add(q(1, 0, 100, 1_000))).toBeNull();
    expect(aggregator.add(q(2, 1, 500, 50))).toBeNull();
    expect(aggregator.add(q(1, 20, 120, 1_100))).toBeNull();
    expect(aggregator.add(q(1, 40, 90, 1_250))).toBeNull();
    expect(aggregator.add(q(1, 59, 110, 1_300))).toBeNull();
    expect(aggregator.formingMinute()).toBe(MINUTE0);

    const closed = aggregator.add(q(1, 61, 111, 1_310));
    expect(closed).toEqual({
      minute: MINUTE0,
      bars: [
        {
          token: 1,
          bucket: bucketOf(MINUTE0),
          open: 100,
          high: 120,
          low: 90,
          close: 110,
          volume: 300,
        },
        {
          token: 2,
          bucket: bucketOf(MINUTE0),
          open: 500,
          high: 500,
          low: 500,
          close: 500,
          volume: 0,
        },
      ],
    });
    expect(aggregator.formingMinute()).toBe(MINUTE0 + 1);
    expect(aggregator.closedBefore()).toBe(MINUTE0 + 1);
  });

  it('counts a minute from the last cumulative before it, whatever minute that was', () => {
    const aggregator = createMinuteAggregator();
    aggregator.add(q(1, 0, 100, 1_000));
    aggregator.add(q(2, 30, 100, 10));
    // Token 1 is silent in the next minute; its next bar counts from 1,000.
    aggregator.add(q(2, 70, 100, 20));
    aggregator.add(q(1, 130, 100, 1_400));
    const closed = aggregator.add(q(1, 190, 100, 1_450));
    expect(closed?.bars).toEqual([expect.objectContaining({ token: 1, volume: 400 })]);
  });

  it('counts a cumulative that drops as a new session, in full', () => {
    const aggregator = createMinuteAggregator();
    aggregator.add(q(1, 0, 100, 9_000));
    aggregator.add(q(1, 10, 100, 9_500));
    aggregator.add(q(1, 20, 100, 200));
    aggregator.add(q(1, 30, 100, 260));
    expect(aggregator.close()?.bars[0]?.volume).toBe(500 + 200 + 60);
  });

  it('ignores late quotes for bars and never lowers the baseline with them', () => {
    const aggregator = createMinuteAggregator();
    aggregator.add(q(1, 0, 100, 1_000));
    aggregator.add(q(1, 61, 100, 1_100));
    // A stray tick of the closed minute: no bar, no new session.
    expect(aggregator.add(q(1, 30, 999, 900))).toBeNull();
    // A late tick with a higher cumulative moves the baseline, so the volume is not lost.
    expect(aggregator.add(q(1, 59, 999, 1_150))).toBeNull();
    aggregator.add(q(1, 62, 100, 1_200));
    const bar = aggregator.close()?.bars[0];
    expect(bar).toMatchObject({ high: 100, low: 100, volume: 100 + 50 });
    expect(aggregator.closedBefore()).toBe(MINUTE0 + 2);
    expect(aggregator.formingMinute()).toBeNull();
    expect(aggregator.close()).toBeNull();
  });

  it('replays written minutes into baselines only, then rebuilds the next minute the same', () => {
    const quotes = [
      q(1, 0, 100, 1_000),
      q(1, 30, 101, 1_040),
      q(1, 61, 102, 1_100),
      q(1, 90, 103, 1_175),
      q(1, 121, 104, 1_180),
    ];
    const straight = createMinuteAggregator();
    const closedStraight = quotes.map((quote) => straight.add(quote)).filter(Boolean);
    expect(closedStraight.map((closed) => closed?.minute)).toEqual([MINUTE0, MINUTE0 + 1]);

    // Minute 0 was written before the restart: its quotes only move the baseline.
    const restarted = createMinuteAggregator({ closedThrough: MINUTE0 });
    expect(restarted.closedBefore()).toBe(MINUTE0 + 1);
    for (const quote of quotes.slice(0, 2)) restarted.observe(quote);
    const closedAgain = quotes
      .slice(2)
      .map((quote) => restarted.add(quote))
      .filter(Boolean);
    expect(closedAgain).toEqual([closedStraight[1]]);
  });

  it('treats a quote of a closed-through minute as late', () => {
    const aggregator = createMinuteAggregator();
    aggregator.closeThrough(MINUTE0);
    expect(aggregator.add(q(1, 30, 100, 1_000))).toBeNull();
    expect(aggregator.formingMinute()).toBeNull();
    aggregator.add(q(1, 70, 100, 1_010));
    expect(aggregator.close()?.bars[0]?.volume).toBe(10);
    expect(() => {
      aggregator.add(q(1, 130, 100, 1_020));
      aggregator.closeThrough(MINUTE0 + 2);
    }).toThrow(/forming minute/);
  });
});
