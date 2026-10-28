import { describe, expect, it } from 'vitest';
import { ZOOM_STEP, zoomedLogicalRange } from './chartZoom';

describe('dashboard chart zoom (NSTOCK-0437)', () => {
  const range = { from: 0, to: 300 };

  it('narrows the bars on screen to zoom in, keeping the latest bar at the right edge', () => {
    expect(zoomedLogicalRange(range, 1)).toEqual({ from: 300 - 300 / ZOOM_STEP, to: 300 });
  });

  it('widens them to zoom out', () => {
    expect(zoomedLogicalRange(range, -1)).toEqual({ from: 300 - 300 * ZOOM_STEP, to: 300 });
  });

  it('stops zooming in at ten bars', () => {
    expect(zoomedLogicalRange(range, 50)).toEqual({ from: 290, to: 300 });
  });

  it('never zooms out on a zoom in when fewer than ten bars are on screen', () => {
    expect(zoomedLogicalRange({ from: 0, to: 6 }, 1)).toEqual({ from: 0, to: 6 });
  });

  it('stops zooming out at two thousand bars', () => {
    expect(zoomedLogicalRange({ from: 0, to: 1_800 }, -1)).toEqual({ from: -200, to: 1_800 });
  });
});
