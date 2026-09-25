import { Candle, CandleRange } from '@nthstock/contracts';
import { fixedClock, fromIst, istDateKey, nseHolidays2026, toIstParts } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import { CANDLE_SPECS, candleTimes, generateCandles, latestSessionOpen } from './candles.js';

// Wednesday 21 Oct 2026, 11:00 IST: the day after Dussehra (Tue 20 Oct, a holiday).
const inSession = fixedClock(fromIst(2026, 10, 21, 11 * 60));
// Saturday 3 Oct 2026: the day after Gandhi Jayanti (Fri 2 Oct, a holiday).
const weekend = fixedClock(fromIst(2026, 10, 3, 12 * 60));

const ranges = CandleRange.options;

function generate(range: CandleRange, clock = inSession, endPrice = 152_345, tick = 5) {
  return generateCandles({
    range,
    clock,
    endPrice,
    startPrice: 140_000,
    volatility: 0.3,
    seed: 17,
    sessionVolume: 1_000_000,
    tick,
  });
}

describe('latestSessionOpen', () => {
  it('is today 9:15 IST once the session has started', () => {
    expect(latestSessionOpen(inSession.now()).toISOString()).toBe(
      fromIst(2026, 10, 21, 555).toISOString(),
    );
  });

  it('skips weekends and holidays back to the last trading day', () => {
    expect(istDateKey(latestSessionOpen(weekend.now()))).toBe('2026-10-01');
    // Before 9:15 on Wed 21 Oct, the latest session is Mon 19 Oct (Tue 20 is Dussehra).
    expect(istDateKey(latestSessionOpen(fromIst(2026, 10, 21, 8 * 60)))).toBe('2026-10-19');
  });

  it('fails loudly on a calendar with no trading days', () => {
    const everyDay: Record<string, string> = {};
    for (let d = 0; d < 400; d += 1) {
      everyDay[istDateKey(new Date(Date.UTC(2025, 8, 1) + d * 86_400_000))] = 'closed';
    }
    expect(() => latestSessionOpen(fromIst(2026, 9, 25, 600), everyDay)).toThrow();
  });
});

describe('generateCandles', () => {
  it.each(ranges)('%s: last close equals the LTP and low ≤ open, close ≤ high', (range) => {
    for (const clock of [inSession, weekend]) {
      const { candles } = generate(range, clock);
      expect(candles.at(-1)?.c).toBe(152_345);
      for (const candle of candles) {
        Candle.parse(candle);
        expect(candle.l).toBeLessThanOrEqual(Math.min(candle.o, candle.c));
        expect(candle.h).toBeGreaterThanOrEqual(Math.max(candle.o, candle.c));
        for (const price of [candle.o, candle.h, candle.l, candle.c]) expect(price % 5).toBe(0);
      }
    }
  });

  it.each(ranges)('%s: no candle falls on a weekend or a holiday', (range) => {
    for (const clock of [inSession, weekend]) {
      for (const candle of generate(range, clock).candles) {
        const at = new Date(candle.t);
        expect(nseHolidays2026[istDateKey(at)]).toBeUndefined();
        expect([0, 6]).not.toContain(toIstParts(at).weekday);
      }
    }
  });

  it('uses the interval for each range', () => {
    expect(ranges.map((r) => generate(r).interval)).toEqual(['1m', '5m', '1h', '1d', '1w']);
    expect(ranges.map((r) => CANDLE_SPECS[r].interval)).toEqual(['1m', '5m', '1h', '1d', '1w']);
  });

  it('starts the path at the start price and is deterministic for a seed', () => {
    const a = generate('1M');
    expect(a.candles[0]?.o).toBe(140_000);
    expect(generate('1M')).toEqual(a);
  });

  it('keeps index levels on a 1-point-hundredth step', () => {
    const { candles } = generate('1D', inSession, 2_512_347, 1);
    expect(candles.at(-1)?.c).toBe(2_512_347);
    expect(candles.every((c) => [c.o, c.h, c.l, c.c].every(Number.isInteger))).toBe(true);
  });

  it('has no volume when no session volume is given', () => {
    const { candles } = generateCandles({
      range: '1D',
      clock: inSession,
      endPrice: 100_000,
      startPrice: 100_000,
      volatility: 0.2,
      seed: 1,
    });
    expect(candles.every((c) => c.v === 0)).toBe(true);
  });
});

describe('candleTimes', () => {
  const ist = (d: Date) => {
    const p = toIstParts(d);
    return `${istDateKey(d)} ${String(Math.floor(p.minuteOfDay / 60))}:${String(p.minuteOfDay % 60).padStart(2, '0')}`;
  };

  it('1D in session: 1-minute bars from 9:15 up to the bar containing now', () => {
    const times = candleTimes('1D', inSession);
    expect(times).toHaveLength(106);
    expect(ist(times[0] as Date)).toBe('2026-10-21 9:15');
    expect(ist(times.at(-1) as Date)).toBe('2026-10-21 11:00');
  });

  it('1D when closed: the whole last session', () => {
    const times = candleTimes('1D', weekend);
    expect(times).toHaveLength(375);
    expect(ist(times[0] as Date)).toBe('2026-10-01 9:15');
    expect(ist(times.at(-1) as Date)).toBe('2026-10-01 15:29');
  });

  it('1W: five sessions of 5-minute bars, skipping the holiday', () => {
    const days = [...new Set(candleTimes('1W', inSession).map(istDateKey))];
    expect(days).toEqual(['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-21']);
    expect(candleTimes('1W', weekend)).toHaveLength(5 * 75);
  });

  it('1M: 22 sessions of hourly bars', () => {
    const times = candleTimes('1M', weekend);
    expect(new Set(times.map(istDateKey)).size).toBe(22);
    expect(times).toHaveLength(22 * 7);
  });

  it('1Y: one bar per trading day for a year', () => {
    const times = candleTimes('1Y', weekend);
    expect(times.length).toBeGreaterThan(240);
    expect(times.length).toBeLessThan(265);
    expect(new Set(times.map(istDateKey)).size).toBe(times.length);
    expect(istDateKey(times.at(-1) as Date)).toBe('2026-10-01');
  });

  it('5Y: one bar per week, on the first trading day of the week', () => {
    const times = candleTimes('5Y', weekend);
    expect(times.length).toBeGreaterThan(255);
    expect(times.length).toBeLessThan(265);
    // The week of 28 Sep 2026 starts Monday 28 Sep.
    expect(istDateKey(times.at(-1) as Date)).toBe('2026-09-28');
    for (let i = 1; i < times.length; i += 1) {
      const gap = (times[i] as Date).getTime() - (times[i - 1] as Date).getTime();
      expect(gap).toBeGreaterThanOrEqual(3 * 86_400_000);
    }
  });

  it('a week that starts on a holiday uses its next trading day', () => {
    // Week of 2 Mar 2026: Tue 3 Mar is Holi; close Monday 2 Mar too, so the bar opens Wednesday.
    const holidays = { ...nseHolidays2026, '2026-03-02': 'Test closure' };
    const times = candleTimes('5Y', fixedClock(fromIst(2026, 3, 7, 600)), holidays);
    expect(istDateKey(times.at(-1) as Date)).toBe('2026-03-04');
  });
});
