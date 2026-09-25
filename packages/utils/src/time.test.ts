import { describe, expect, it } from 'vitest';
import {
  fixedClock,
  formatIstDate,
  formatIstTime,
  fromIst,
  istDateKey,
  systemClock,
  toIstParts,
} from './time.js';

// 03:45 UTC is 09:15 IST.
const marketOpenUtc = new Date('2026-09-25T03:45:00Z');

describe('IST helpers', () => {
  it('formats time and date in IST whatever the machine time zone is', () => {
    expect(formatIstTime(marketOpenUtc).toLowerCase()).toBe('09:15 am');
    expect(formatIstDate(marketOpenUtc)).toMatch(/^25 Sept? 2026$/);
  });

  it('rolls the date over at IST midnight, not UTC midnight', () => {
    expect(istDateKey(new Date('2026-09-25T18:29:59Z'))).toBe('2026-09-25');
    expect(istDateKey(new Date('2026-09-25T18:30:00Z'))).toBe('2026-09-26');
  });

  it('splits an instant into IST parts', () => {
    expect(toIstParts(marketOpenUtc)).toEqual({
      year: 2026,
      month: 9,
      day: 25,
      weekday: 5,
      minuteOfDay: 555,
    });
  });

  it('builds an instant from IST wall-clock time', () => {
    expect(fromIst(2026, 9, 25, 9 * 60 + 15).toISOString()).toBe('2026-09-25T03:45:00.000Z');
    expect(fromIst(2026, 12, 32, 0).toISOString()).toBe('2026-12-31T18:30:00.000Z');
  });

  it('reports the machine time zone the suite is running in', () => {
    // Documents that the package script runs this file under UTC and America/New_York.
    expect(['UTC', 'Etc/UTC', 'America/New_York']).toContain(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });
});

describe('clocks', () => {
  it('fixedClock always returns the same instant as a fresh Date', () => {
    const clock = fixedClock('2026-09-25T03:45:00Z');
    const first = clock.now();
    first.setFullYear(2000);
    expect(clock.now().toISOString()).toBe('2026-09-25T03:45:00.000Z');
  });

  it('fixedClock rejects invalid input', () => {
    expect(() => fixedClock('not a date')).toThrow(RangeError);
  });

  it('systemClock follows real time', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
  });
});
