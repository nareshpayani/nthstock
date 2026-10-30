import type { Candle } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import {
  barIndex,
  fibPrices,
  formatSpan,
  logicalToTime,
  measure,
  keepsEscape,
  parseDrawings,
  priceStep,
  snapToBar,
  timeToLogical,
} from './drawings';

const T0 = Date.parse('2026-10-28T04:00:00Z') / 1000;
const bars: Candle[] = [0, 1, 2, 3].map((i) => ({
  t: new Date((T0 + i * 300) * 1000).toISOString(),
  o: 10_000 + i * 100,
  h: 10_200 + i * 100,
  l: 9_900 + i * 100,
  c: 10_100 + i * 100,
  v: 10,
}));

describe('chart drawings (NSTOCK-0461)', () => {
  it('places retracement levels from the end of the move back to its start', () => {
    const levels = fibPrices({ time: T0, price: 10_000 }, { time: T0 + 600, price: 20_000 });
    expect(levels[0]).toEqual({ level: 0, price: 20_000 });
    expect(levels.find((l) => l.level === 0.5)?.price).toBe(15_000);
    expect(levels.at(-1)).toEqual({ level: 1, price: 10_000 });
  });

  it('measures change, percent, bars and time', () => {
    expect(measure({ time: T0, price: 10_000 }, { time: T0 + 900, price: 10_250 }, bars)).toEqual({
      change: 250,
      basisPoints: 250,
      bars: 3,
      seconds: 900,
    });
    expect(formatSpan(900)).toBe('15m');
    expect(formatSpan(8100)).toBe('2h 15m');
    expect(formatSpan(3 * 86_400 + 4 * 3600)).toBe('3d 4h');
  });

  it('finds the bar at or before a time', () => {
    expect(barIndex(bars, T0 - 10)).toBe(0);
    expect(barIndex(bars, T0 + 450)).toBe(1);
    expect(barIndex(bars, T0 + 5000)).toBe(3);
  });

  it('snaps a point to the nearest open, high, low or close of its bar', () => {
    expect(snapToBar({ time: T0 + 310, price: 10_290 }, bars)).toEqual({
      time: T0 + 300,
      price: 10_300,
    });
  });

  it('maps time to bar positions and back, between and past the bars', () => {
    expect(timeToLogical(bars, T0 + 300)).toBe(1);
    expect(timeToLogical(bars, T0 + 450)).toBe(1.5);
    expect(timeToLogical(bars, T0 + 1200)).toBe(4);
    expect(timeToLogical(bars, T0 - 300)).toBe(-1);
    expect(logicalToTime(bars, 1.5)).toBe(T0 + 450);
    expect(logicalToTime(bars, 5)).toBe(T0 + 1500);
  });

  it('keeps only well-formed stored drawings', () => {
    const at = { time: T0, price: 1 };
    expect(
      parseDrawings([
        { id: 'a', kind: 'horizontal', at },
        { id: 'b', kind: 'text', at, text: 'note' },
        { id: 'c', kind: 'trend', from: at },
        { id: 'd', kind: 'circle', at },
        null,
      ]).map((d) => d.id),
    ).toEqual(['a', 'b']);
    expect(parseDrawings('nope')).toEqual([]);
  });
});

describe('keyboard point helpers (NSTOCK-0468)', () => {
  it('never steps under one 5-paise tick, even for no span or a bad one', () => {
    expect(priceStep(0)).toBe(5);
    expect(priceStep(Number.NaN)).toBe(5);
    expect(priceStep(Number.POSITIVE_INFINITY)).toBe(5);
    expect(priceStep(100)).toBe(5);
  });

  it('rounds a fiftieth of the span up to 1, 2 or 5 times a power of ten', () => {
    expect(priceStep(500)).toBe(10); // 10 -> 1 x 10
    expect(priceStep(1_100)).toBe(50); // 22 -> 5 x 10
    expect(priceStep(2_500)).toBe(50); // 50 -> 5 x 10
    expect(priceStep(5_200)).toBe(200); // 104 -> 2 x 100
    expect(priceStep(-5_200)).toBe(200); // a span is a distance
    expect(priceStep(100_000)).toBe(2_000);
  });

  it('keeps Escape for fields, selects, open menus and their items', () => {
    const input = document.createElement('input');
    const select = document.createElement('select');
    const expanded = document.createElement('button');
    expanded.setAttribute('aria-expanded', 'true');
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('div');
    menu.append(item);
    const plain = document.createElement('div');
    for (const element of [input, select, expanded, item]) expect(keepsEscape(element)).toBe(true);
    expect(keepsEscape(plain)).toBe(false);
    expect(keepsEscape(window)).toBe(false);
    expect(keepsEscape(null)).toBe(false);
  });
});
