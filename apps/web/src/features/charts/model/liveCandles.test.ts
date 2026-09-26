import type { Candle } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { testQuote } from '@/test/quotes';
import { applyTick, quoteToTick, trailingChanges } from './liveCandles';

// Two 1-minute bars: 14:04 and 14:05 IST on Friday 25 Sep 2026.
const bars: Candle[] = [
  { t: '2026-09-25T08:34:00.000Z', o: 150000, h: 150200, l: 149900, c: 150100, v: 40 },
  { t: '2026-09-25T08:35:00.000Z', o: 150100, h: 150300, l: 150000, c: 150200, v: 25 },
];
const at = (iso: string) => Date.parse(iso);

describe('live 1-minute bars (T-108)', () => {
  it('a tick in the same minute updates the last bar', () => {
    const next = applyTick(bars, {
      price: 150450,
      at: at('2026-09-25T08:35:42.000Z'),
      volumeDelta: 5,
    });
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(bars[0]);
    expect(next[1]).toEqual({ ...bars[1], h: 150450, c: 150450, v: 30 });

    const lower = applyTick(next, {
      price: 149800,
      at: at('2026-09-25T08:35:50.000Z'),
      volumeDelta: 0,
    });
    expect(lower[1]).toMatchObject({ o: 150100, h: 150450, l: 149800, c: 149800 });
  });

  it('a tick in the next minute appends a bar opening at its price', () => {
    const next = applyTick(bars, {
      price: 150250,
      at: at('2026-09-25T08:36:03.000Z'),
      volumeDelta: 7,
    });
    expect(next).toHaveLength(3);
    expect(next.slice(0, 2)).toEqual(bars);
    expect(next[2]).toEqual({
      t: '2026-09-25T08:36:00.000Z',
      o: 150250,
      h: 150250,
      l: 150250,
      c: 150250,
      v: 7,
    });
  });

  it('ignores an older tick, a repeat, and a tick from the next IST day', () => {
    expect(applyTick(bars, { price: 1, at: at('2026-09-25T08:34:10.000Z'), volumeDelta: 0 })).toBe(
      bars,
    );
    expect(
      applyTick(bars, { price: 150200, at: at('2026-09-25T08:35:10.000Z'), volumeDelta: 0 }),
    ).toBe(bars);
    // 09:15 IST on Monday 28 Sep.
    expect(
      applyTick(bars, { price: 150500, at: at('2026-09-28T03:45:00.000Z'), volumeDelta: 1 }),
    ).toBe(bars);
    expect(applyTick(bars, { price: 1, at: Number.NaN, volumeDelta: 0 })).toBe(bars);
  });

  it('starts a series from the first tick when there are no bars yet', () => {
    expect(
      applyTick([], { price: 150000, at: at('2026-09-25T03:45:30.000Z'), volumeDelta: 0 }),
    ).toEqual([
      { t: '2026-09-25T03:45:00.000Z', o: 150000, h: 150000, l: 150000, c: 150000, v: 0 },
    ]);
  });

  it('turns quotes into ticks with the volume traded since the previous quote', () => {
    const first = testQuote('INFY', 150100, { volume: 1_000 });
    const second = testQuote('INFY', 150200, { volume: 1_250, ts: '2026-09-25T08:35:01.000Z' });
    expect(quoteToTick(second, first)).toEqual({
      price: 150200,
      at: at('2026-09-25T08:35:01.000Z'),
      volumeDelta: 250,
    });
    expect(quoteToTick(first, undefined).volumeDelta).toBe(0);
    expect(quoteToTick(first, second).volumeDelta).toBe(0);
  });

  it('finds the trailing bars to update in place, or null for a full redraw', () => {
    const updated = applyTick(bars, {
      price: 150400,
      at: at('2026-09-25T08:35:30.000Z'),
      volumeDelta: 0,
    });
    expect(trailingChanges(bars, updated)).toEqual([updated[1]]);
    const appended = applyTick(bars, {
      price: 150400,
      at: at('2026-09-25T08:36:30.000Z'),
      volumeDelta: 0,
    });
    expect(trailingChanges(bars, appended)).toEqual([appended[2]]);
    expect(trailingChanges(bars, bars)).toEqual([]);
    expect(trailingChanges([], bars)).toBeNull();
    expect(trailingChanges(bars, [{ ...bars[0] } as Candle, bars[1] as Candle])).toBeNull();
    expect(trailingChanges(bars, [bars[0] as Candle])).toBeNull();
  });
});
