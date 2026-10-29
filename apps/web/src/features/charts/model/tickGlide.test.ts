import type { UTCTimestamp } from 'lightweight-charts';
import { describe, expect, it } from 'vitest';
import { closeOf, glidePoint } from './tickGlide';

const time = 1_700_000_000 as UTCTimestamp;

describe('tick glide (A16)', () => {
  it('eases a line point from the old price to the new one', () => {
    const to = { time, value: 110 };
    expect(glidePoint(to, 100, 0)).toEqual({ time, value: 100 });
    expect(closeOf(glidePoint(to, 100, 0.5))).toBe(108.75);
    expect(glidePoint(to, 100, 1)).toEqual(to);
    expect(glidePoint(to, 100, 3)).toEqual(to);
    expect(glidePoint(to, 100, -2)).toEqual({ time, value: 100 });
  });

  it('eases a falling price down', () => {
    expect(closeOf(glidePoint({ time, value: 90 }, 100, 0.5))).toBe(91.25);
  });

  it('moves only a bar close, which stays inside the bar', () => {
    const to = { time, open: 100, high: 112, low: 98, close: 111 };
    const mid = glidePoint(to, 104, 0.4);
    expect(mid).toMatchObject({ open: 100, high: 112, low: 98 });
    expect(closeOf(mid)).toBeGreaterThan(104);
    expect(closeOf(mid)).toBeLessThan(111);
  });
});
