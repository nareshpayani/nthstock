import { describe, expect, it } from 'vitest';
import { makeCandles } from '@/test/candles';
import { seriesDirection, toAreaData, toCandleData, toChartTime } from './chartData';

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
