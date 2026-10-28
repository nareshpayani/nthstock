import { describe, expect, it } from 'vitest';
import { LOUPE_INSET, loupeText, placeLoupe } from './loupe';

describe('loupe text (CR-T07, SPEC-CR-1 §4.2)', () => {
  it('an order: its price, distance from the LTP and value at that price', () => {
    expect(loupeText(152_450, 152_820, { kind: 'value', qty: 4 })).toEqual({
      price: '₹1,524.50',
      distance: '−0.24% from LTP',
      detail: '4 × ₹1,524.50 = ₹6,098.00',
    });
    expect(loupeText(153_000, 152_820).distance).toBe('+0.12% from LTP');
    expect(loupeText(152_820, 152_820).distance).toBe('At LTP');
  });

  it('a stop: the estimated P&L against the average, long or short', () => {
    expect(loupeText(151_000, 152_000, { kind: 'pnl', qty: 4, avgPrice: 150_000 }).detail).toBe(
      'Est. P&L +₹40.00',
    );
    expect(loupeText(151_000, 152_000, { kind: 'pnl', qty: -2, avgPrice: 150_000 }).detail).toBe(
      'Est. P&L −₹20.00',
    );
  });

  it('with no LTP and nothing to work out, the price alone', () => {
    expect(loupeText(150_000, undefined)).toEqual({
      price: '₹1,500.00',
      distance: null,
      detail: null,
    });
  });
});

describe('loupe placement (CR-T07, AC-03)', () => {
  const card = { cardWidth: 176, cardHeight: 72 };
  const inside = (place: { left: number; top: number }, width: number, height: number) =>
    place.left >= LOUPE_INSET - 0.001 &&
    place.top >= LOUPE_INSET - 0.001 &&
    place.left + card.cardWidth <= width - LOUPE_INSET + 0.001 &&
    place.top + card.cardHeight <= height - LOUPE_INSET + 0.001;

  it('sits above the finger, left of it above the LTP and right of it below', () => {
    const at = { y: 200, width: 390, height: 300, ...card };
    expect(placeLoupe({ ...at, x: 250, aboveLtp: true })).toEqual({
      left: 250 - 28 - 176,
      top: 72,
      side: 'left',
    });
    expect(placeLoupe({ ...at, x: 150, aboveLtp: false })).toEqual({
      left: 178,
      top: 72,
      side: 'right',
    });
  });

  it('flips at the edges and goes under the finger near the top', () => {
    expect(
      placeLoupe({ x: 40, y: 200, width: 390, height: 300, ...card, aboveLtp: true }).side,
    ).toBe('right');
    expect(
      placeLoupe({ x: 380, y: 200, width: 390, height: 300, ...card, aboveLtp: false }).side,
    ).toBe('left');
    expect(
      placeLoupe({ x: 200, y: 40, width: 390, height: 300, ...card, aboveLtp: true }).top,
    ).toBe(96);
  });

  it('stays whole on the chart at every matrix width, anywhere the finger goes', () => {
    for (const width of [
      320, 344, 360, 375, 390, 393, 402, 412, 430, 440, 673, 820, 844, 1180, 1440,
    ]) {
      for (const height of [220, 300, 420]) {
        for (let x = 0; x <= width; x += 16) {
          for (let y = 0; y <= height; y += 16) {
            for (const aboveLtp of [true, false]) {
              const place = placeLoupe({ x, y, width, height, ...card, aboveLtp });
              expect(
                inside(place, width, height),
                `${String(width)}×${String(height)} at ${String(x)},${String(y)}`,
              ).toBe(true);
            }
          }
        }
      }
    }
  });
});
