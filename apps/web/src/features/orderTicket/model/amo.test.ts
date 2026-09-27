import { fixedClock, formatIstDate, fromIst } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import { amoDate } from './amo';

describe('amoDate (T-138)', () => {
  it('is the next trading day after a weekend', () => {
    // Saturday 26 Sep 2026 → Monday 28 Sep.
    expect(amoDate(fixedClock(fromIst(2026, 9, 26, 11 * 60)))).toBe(
      formatIstDate(fromIst(2026, 9, 28, 9 * 60 + 15)),
    );
  });

  it('is today before 9:15 AM on a trading day', () => {
    expect(amoDate(fixedClock(fromIst(2026, 9, 28, 8 * 60)))).toBe(
      formatIstDate(fromIst(2026, 9, 28, 9 * 60 + 15)),
    );
  });

  it('skips an NSE holiday (Gandhi Jayanti, Friday 2 Oct 2026)', () => {
    // Thursday 1 Oct after the close → Monday 5 Oct.
    expect(amoDate(fixedClock(fromIst(2026, 10, 1, 16 * 60)))).toBe(
      formatIstDate(fromIst(2026, 10, 5, 9 * 60 + 15)),
    );
  });
});
