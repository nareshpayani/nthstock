import type { Candle } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import {
  barIndex,
  drawingPrices,
  fibPrices,
  formatSpan,
  keepsEscape,
  logicalToTime,
  measure,
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

describe('keyboard placement helpers (NSTOCK-0468)', () => {
  it('steps prices by about a fiftieth of the view, in 1, 2 or 5 times a power of ten', () => {
    expect(priceStep(15_000)).toBe(500);
    expect(priceStep(5_000)).toBe(100);
    expect(priceStep(7_000)).toBe(200);
    expect(priceStep(60_000)).toBe(2_000);
    expect(priceStep(-15_000)).toBe(500);
  });

  it('never steps under one 5-paise tick, nor on an empty or broken span', () => {
    expect(priceStep(100)).toBe(5);
    expect(priceStep(0)).toBe(5);
    expect(priceStep(Number.NaN)).toBe(5);
    expect(priceStep(Number.POSITIVE_INFINITY)).toBe(5);
  });

  it('names the prices each drawing sits on', () => {
    const at = { time: T0, price: 10_000 };
    const to = { time: T0 + 300, price: 10_500 };
    expect(drawingPrices({ id: 'a', kind: 'horizontal', at })).toEqual([10_000]);
    expect(drawingPrices({ id: 'b', kind: 'text', at, text: 'x' })).toEqual([10_000]);
    expect(drawingPrices({ id: 'c', kind: 'trend', from: at, to })).toEqual([10_000, 10_500]);
  });
});

describe('keepsEscape', () => {
  it('leaves Escape to text fields, selects, open menus and expanded controls', () => {
    document.body.innerHTML = `
      <input id="field" /><textarea id="area"></textarea><select id="pick"></select>
      <button id="open" aria-expanded="true"></button>
      <div role="menu"><button id="item"></button></div>
      <div role="listbox"><div id="option"></div></div>
      <button id="plain"></button>`;
    for (const id of ['field', 'area', 'pick', 'open', 'item', 'option'])
      expect(keepsEscape(document.getElementById(id))).toBe(true);
    expect(keepsEscape(document.getElementById('plain'))).toBe(false);
    expect(keepsEscape(window)).toBe(false);
    expect(keepsEscape(null)).toBe(false);
  });
});
