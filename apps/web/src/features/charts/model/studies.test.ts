import type { Candle } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { bollinger, ema, hasVolume, isStudyId, sma, studyLines, vwap } from './studies';

const bar = (t: string, c: number, v = 100, h = c, l = c): Candle => ({ t, o: c, h, l, c, v });

describe('chart studies (NSTOCK-0460)', () => {
  it('averages the last n values, null until there are n', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('seeds the EMA with the simple average, then weights recent values more', () => {
    const out = ema([10, 20, 30, 40], 3);
    expect(out.slice(0, 3)).toEqual([null, null, 20]);
    // k = 0.5: 40 * 0.5 + 20 * 0.5
    expect(out[3]).toBe(30);
  });

  it('weights VWAP by volume and starts again each IST session', () => {
    const out = vwap([
      bar('2026-10-28T04:00:00Z', 100, 1),
      bar('2026-10-28T05:00:00Z', 200, 3),
      // 03:45Z is 09:15 IST on the next day: a new session.
      bar('2026-10-29T03:45:00Z', 400, 2),
    ]);
    expect(out).toEqual([100, 175, 400]);
  });

  it('leaves VWAP empty when nothing traded', () => {
    expect(
      vwap([bar('2026-10-28T04:00:00Z', 100, 0), bar('2026-10-28T05:00:00Z', 100, 0)]),
    ).toEqual([null, null]);
  });

  it('leaves VWAP empty on daily bars, where each bar is its own session', () => {
    expect(
      vwap([
        bar('2026-10-26T03:45:00Z', 100, 5),
        bar('2026-10-27T03:45:00Z', 200, 5),
        bar('2026-10-28T03:45:00Z', 300, 5),
      ]),
    ).toEqual([null, null, null]);
  });

  it('puts Bollinger bands two deviations either side of the average', () => {
    const [band] = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2).slice(-1);
    // mean 5, population deviation 2
    expect(band).toEqual({ upper: 9, middle: 5, lower: 1 });
  });

  it('draws three lines for Bollinger and one for each average', () => {
    const candles = Array.from({ length: 25 }, (_, i) =>
      bar(`2026-10-28T04:${String(i).padStart(2, '0')}:00Z`, 100 + i),
    );
    expect(studyLines('bollinger', candles).map((line) => line.key)).toEqual([
      'bollinger-upper',
      'bollinger-middle',
      'bollinger-lower',
    ]);
    expect(studyLines('sma20', candles)[0]?.values.at(-1)).toBe(115);
    expect(studyLines('volume', candles)).toEqual([]);
  });

  it('knows its ids and whether there is volume', () => {
    expect(isStudyId('vwap')).toBe(true);
    expect(isStudyId('rsi')).toBe(false);
    expect(hasVolume([bar('2026-10-28T04:00:00Z', 1, 0)])).toBe(false);
  });
});
