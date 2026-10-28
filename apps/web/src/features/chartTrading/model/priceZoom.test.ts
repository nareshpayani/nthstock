import { describe, expect, it } from 'vitest';
import { PRICE_ZOOM_PX, zoomedPriceRange } from './priceZoom';

describe('price-axis zoom (NSTOCK-0436)', () => {
  const range = { from: 1_400, to: 1_600 };

  it('keeps the range where it is for no drag', () => {
    expect(zoomedPriceRange(range, 0)).toEqual(range);
  });

  it('widens the range around its middle when dragged down, narrows it when dragged up', () => {
    const down = zoomedPriceRange(range, PRICE_ZOOM_PX);
    expect((down.from + down.to) / 2).toBeCloseTo(1_500);
    expect(down.to - down.from).toBeCloseTo(200 * Math.E);
    const up = zoomedPriceRange(range, -PRICE_ZOOM_PX);
    expect(up.to - up.from).toBeCloseTo(200 / Math.E);
  });

  it('stops at twenty times either way', () => {
    expect(zoomedPriceRange(range, 10_000).to - zoomedPriceRange(range, 10_000).from).toBeCloseTo(
      4_000,
    );
    expect(zoomedPriceRange(range, -10_000).to - zoomedPriceRange(range, -10_000).from).toBeCloseTo(
      10,
    );
  });
});
