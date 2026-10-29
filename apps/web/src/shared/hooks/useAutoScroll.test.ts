import { describe, expect, it } from 'vitest';
import {
  AUTO_SCROLL_CYCLES,
  AUTO_SCROLL_REST_MS,
  AUTO_SCROLL_SPEED,
  driftAt,
} from './useAutoScroll';

describe('driftAt (A21)', () => {
  const overflow = 200;
  const travel = (overflow / AUTO_SCROLL_SPEED) * 1000;

  it('rests at the start, drifts out, rests at the end and drifts back', () => {
    expect(driftAt(0, overflow)).toBe(0);
    expect(driftAt(AUTO_SCROLL_REST_MS + travel / 2, overflow)).toBeCloseTo(0.5);
    expect(driftAt(AUTO_SCROLL_REST_MS * 1.5 + travel, overflow)).toBe(1);
    expect(driftAt(AUTO_SCROLL_REST_MS * 2 + travel * 1.5, overflow)).toBeCloseTo(0.5);
  });

  it('does nothing when everything fits, and stops after its cycles', () => {
    expect(driftAt(1000, 0)).toBeNull();
    const cycle = 2 * (AUTO_SCROLL_REST_MS + travel);
    expect(driftAt(cycle * AUTO_SCROLL_CYCLES - 1, overflow)).not.toBeNull();
    expect(driftAt(cycle * AUTO_SCROLL_CYCLES, overflow)).toBeNull();
  });
});
