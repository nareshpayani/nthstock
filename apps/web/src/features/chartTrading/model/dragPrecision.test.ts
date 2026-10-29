import { describe, expect, it } from 'vitest';
import { EDGE_PX, FINE_PX, edgeScroll, fineFactor, fineY } from './dragPrecision';

describe('drag precision (A10)', () => {
  it('follows 1:1 straight up and down, slower the further the thumb slides sideways', () => {
    expect(fineFactor(0)).toBe(1);
    expect(fineFactor(FINE_PX)).toBe(0.5);
    expect(fineFactor(-FINE_PX * 3)).toBe(0.25);
    expect(fineFactor(10_000)).toBe(0.2);
  });

  it('moves the drag by the thumb movement times the factor', () => {
    expect(fineY(100, 50, 70, 1)).toBe(120);
    expect(fineY(100, 50, 70, 0.25)).toBe(105);
  });

  it('scrolls only near an edge, faster at the edge, up at the top and down at the bottom', () => {
    expect(edgeScroll(150, 300)).toBe(0);
    expect(edgeScroll(EDGE_PX / 2, 300)).toBeGreaterThan(0);
    expect(edgeScroll(0, 300)).toBeGreaterThan(edgeScroll(EDGE_PX / 2, 300));
    expect(edgeScroll(300 - 2, 300)).toBeLessThan(0);
    expect(edgeScroll(10, 40)).toBe(0);
  });
});
