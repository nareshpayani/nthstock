import { describe, expect, it } from 'vitest';
import { FIGURE_SPACE, MIN_BAR_PERCENT, barPercent, depthScale, padToWidest } from './depthBars';

const levels = (qtys: number[]) => qtys.map((qty, i) => ({ price: 1_000 + i * 5, qty, orders: 1 }));
const depthFixture = { bids: levels([120, 80, 40, 20, 10]), asks: levels([100, 60, 30, 15, 5]) };

describe('depth bars', () => {
  it('scales against the largest quantity on either side', () => {
    expect(depthScale(depthFixture)).toBe(120);
    const asksBigger = {
      bids: depthFixture.bids,
      asks: depthFixture.asks.map((level, i) => (i === 2 ? { ...level, qty: 480 } : level)),
    };
    expect(depthScale(asksBigger)).toBe(480);
  });

  it('gives whole percents proportional to quantity', () => {
    expect(barPercent(120, 120)).toBe(100);
    expect(barPercent(60, 120)).toBe(50);
    expect(barPercent(40, 120)).toBe(33);
  });

  it('keeps tiny levels visible and empty ones empty', () => {
    expect(barPercent(1, 10_000)).toBe(MIN_BAR_PERCENT);
    expect(barPercent(0, 120)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
  });

  it('pads numbers to the widest with figure spaces', () => {
    const f = FIGURE_SPACE;
    expect(padToWidest(['980', '1,020', '7'])).toEqual([
      `${f}${f}980`,
      '1,020',
      `${f}${f}${f}${f}7`,
    ]);
    expect(padToWidest([])).toEqual([]);
  });
});
