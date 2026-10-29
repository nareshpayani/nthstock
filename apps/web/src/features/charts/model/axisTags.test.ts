import { describe, expect, it } from 'vitest';
import { TAG_CLEARANCE_PX, visibleTickLabels } from './axisTags';

describe('visibleTickLabels', () => {
  // 4 px per rupee, top of the axis at ₹1,520.
  const y = (price: number) => (1520 - price) * 4;

  it('leaves out the labels a tag would half cover and keeps the rest', () => {
    const prices = [1520, 1510, 1500, 1490, 1480];
    // The live price tag at ₹1,496.70 (row 93) sits over the ₹1,500 label (row 80).
    expect(visibleTickLabels(prices, y, [y(1496.7)])).toEqual([true, true, false, true, true]);
  });

  it('keeps every label without tags, and one exactly at the clearance', () => {
    expect(visibleTickLabels([1500, 1490], y, [])).toEqual([true, true]);
    expect(visibleTickLabels([1500], y, [y(1500) + TAG_CLEARANCE_PX])).toEqual([true]);
  });

  it('keeps a label whose price is off the scale', () => {
    expect(visibleTickLabels([2000], () => null, [0])).toEqual([true]);
  });
});
