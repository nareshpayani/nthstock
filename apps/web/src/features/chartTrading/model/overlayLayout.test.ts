import { describe, expect, it } from 'vitest';
import { LABEL_GAP, layoutHandles, snapToTick } from './overlayLayout';

// 1 px per paise, ₹0.00 at y = 300 and ₹3.00 at y = 0.
const toY = (price: number) => 300 - price;
const opts = { height: 300 };

describe('overlay layout (T15, SPEC-TFC-1 §8.4, §10.5)', () => {
  it('puts a label on its line when there is room', () => {
    expect(layoutHandles([{ id: 'a', price: 150 }], toY, opts)).toEqual([
      { id: 'a', lineY: 150, labelY: 150, pinned: null },
    ]);
  });

  it('pins a line above or below the visible range to that edge', () => {
    const [above, below, unknown] = layoutHandles(
      [
        { id: 'up', price: 900 },
        { id: 'down', price: -50 },
        { id: 'none', price: 10 },
      ],
      (price) => (price === 10 ? null : toY(price)),
      opts,
    );
    expect(above).toMatchObject({ lineY: null, pinned: 'top', labelY: 22 });
    expect(below).toMatchObject({ lineY: null, pinned: 'bottom', labelY: 278 });
    expect(unknown).toMatchObject({ lineY: null, pinned: 'top' });
  });

  it('spreads labels that would overlap by one touch target, keeping their order', () => {
    const layout = layoutHandles(
      [
        { id: 'a', price: 150 },
        { id: 'b', price: 145 },
        { id: 'c', price: 140 },
      ],
      toY,
      opts,
    );
    expect(layout.map((place) => place.labelY)).toEqual([
      150,
      150 + LABEL_GAP,
      150 + 2 * LABEL_GAP,
    ]);
    expect(layout.map((place) => place.lineY)).toEqual([150, 155, 160]);
  });

  it('pulls a spread that runs past the bottom back inside the pane', () => {
    const layout = layoutHandles(
      [
        { id: 'a', price: 10 },
        { id: 'b', price: 8 },
      ],
      toY,
      opts,
    );
    expect(layout.map((place) => place.labelY)).toEqual([278 - LABEL_GAP, 278]);
  });

  it('keeps the caller order for lines at the same price (hit priority)', () => {
    const layout = layoutHandles(
      [
        { id: 'order', price: 100 },
        { id: 'position', price: 100 },
      ],
      toY,
      opts,
    );
    expect(layout[0]?.labelY).toBeLessThan(layout[1]?.labelY ?? 0);
  });

  it('snaps a price to the tick, never below one tick', () => {
    expect(snapToTick(123_457, 5)).toBe(123_455);
    expect(snapToTick(123_458, 5)).toBe(123_460);
    expect(snapToTick(-40, 5)).toBe(5);
  });
});
