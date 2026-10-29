import { describe, expect, it } from 'vitest';
import { makeCandles } from '@/test/candles';
import { seriesDirection, toAreaData, toCandleData, toChartTime, toHeikinAshi } from './chartData';

describe('chart data (T-094)', () => {
  it('maps candles to UTC seconds with integer values', () => {
    const candles = makeCandles({ count: 2 });
    expect(toChartTime('2026-09-25T03:45:00.000Z')).toBe(1_790_307_900);
    expect(toAreaData(candles)).toEqual([
      { time: 1_790_307_900, value: candles[0]?.c },
      { time: 1_790_307_960, value: candles[1]?.c },
    ]);
    expect(toCandleData(candles)[0]).toEqual({
      time: 1_790_307_900,
      open: candles[0]?.o,
      high: candles[0]?.h,
      low: candles[0]?.l,
      close: candles[0]?.c,
    });
  });

  it('reads the direction from the first open and the last close', () => {
    expect(seriesDirection([])).toBe('flat');
    expect(seriesDirection(makeCandles({ count: 5, step: 100 }))).toBe('up');
    expect(seriesDirection(makeCandles({ count: 5, step: -100 }))).toBe('down');
    const [one] = makeCandles({ count: 1 });
    expect(seriesDirection(one ? [{ ...one, c: one.o }] : [])).toBe('flat');
  });
});

describe('Heikin-Ashi (NSTOCK-0430)', () => {
  const [template] = makeCandles({ count: 1 });
  if (!template) throw new Error('no candle');
  const bar = (t: string, o: number, h: number, l: number, c: number) => ({
    ...template,
    t,
    o,
    h,
    l,
    c,
  });

  it('smooths a known series: close is the OHLC mean, open the previous midpoint', () => {
    const ha = toHeikinAshi([
      bar('2026-10-28T03:45:00Z', 100, 110, 90, 104),
      bar('2026-10-28T03:46:00Z', 104, 112, 100, 108),
      bar('2026-10-28T03:47:00Z', 108, 109, 95, 96),
    ]);
    expect(ha.map(({ o, h, l, c }) => [o, h, l, c])).toEqual([
      [102, 110, 90, 101], // o = (100+104)/2, c = 404/4
      [102, 112, 100, 106], // o = (102+101)/2 = 101.5 → 102, c = 424/4
      [104, 109, 95, 102], // o = (102+106)/2, c = 408/4
    ]);
  });

  it('a change to the last bar changes only the last Heikin-Ashi bar', () => {
    const first = bar('2026-10-28T03:45:00Z', 100, 110, 90, 104);
    const last = bar('2026-10-28T03:46:00Z', 104, 112, 100, 108);
    const base = [first, last];
    const ticked = [first, { ...last, c: 111, h: 113 }];
    const before = toHeikinAshi(base);
    const after = toHeikinAshi(ticked);
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).not.toEqual(before[1]);
    expect(toHeikinAshi([])).toEqual([]);
  });
});
