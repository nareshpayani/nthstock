import { describe, expect, it } from 'vitest';
import { PRICE_ZOOM_PX, zoomedPriceRange } from './priceZoom';

describe('price-axis zoom (NSTOCK-0436)', () => {
  const range = { from: 1_400, to: 1_600 };

  it('keeps the range where it is for no drag', () => {
    expect(zoomedPriceRange(range, 0, 5)).toEqual(range);
  });

  it('widens the range around its middle when dragged down, narrows it when dragged up', () => {
    const down = zoomedPriceRange(range, PRICE_ZOOM_PX, 5);
    expect((down.from + down.to) / 2).toBeCloseTo(1_500);
    expect(down.to - down.from).toBeCloseTo(200 * Math.E);
    const up = zoomedPriceRange(range, -PRICE_ZOOM_PX, 5);
    expect(up.to - up.from).toBeCloseTo(200 / Math.E);
  });

  it('stops at twenty times either way', () => {
    const wide = zoomedPriceRange({ from: 10_000, to: 10_200 }, 10_000, 5);
    expect(wide.to - wide.from).toBeCloseTo(4_000);
    const narrow = zoomedPriceRange(range, -10_000, 5);
    expect(narrow.to - narrow.from).toBeCloseTo(10);
  });

  it('never takes the foot of the axis below the floor (one tick)', () => {
    const out = zoomedPriceRange(range, 10_000, 5);
    expect(out.from).toBe(5);
    expect(out.to).toBeCloseTo(1_500 + 100 * 20);
  });
});
