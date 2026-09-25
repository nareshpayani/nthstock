import { describe, expect, it } from 'vitest';
import { getMarketStatus, isTradingDay, nextSessionOpen } from './marketCalendar.js';
import { nseHolidays2026 } from './nseHolidays2026.js';
import { fixedClock, fromIst, toIstParts } from './time.js';

// Friday 25 Sep 2026 is a normal trading day.
const at = (hour: number, minute: number, day = 25, month = 9) =>
  fixedClock(fromIst(2026, month, day, hour * 60 + minute));

describe('getMarketStatus', () => {
  it.each([
    [8, 59, { state: 'closed', reason: 'beforeHours' }],
    [9, 0, { state: 'preOpen' }],
    [9, 14, { state: 'preOpen' }],
    [9, 15, { state: 'open' }],
    [15, 29, { state: 'open' }],
    [15, 30, { state: 'closed', reason: 'afterHours' }],
    [15, 31, { state: 'closed', reason: 'afterHours' }],
  ])('%i:%i IST on a trading day', (hour, minute, expected) => {
    expect(getMarketStatus(at(hour, minute))).toEqual(expected);
  });

  it('is closed all weekend', () => {
    expect(getMarketStatus(at(11, 0, 26))).toEqual({ state: 'closed', reason: 'weekend' });
    expect(getMarketStatus(at(11, 0, 27))).toEqual({ state: 'closed', reason: 'weekend' });
  });

  it('is closed on a listed holiday, with its name', () => {
    expect(getMarketStatus(at(11, 0, 2, 10))).toEqual({
      state: 'closed',
      reason: 'holiday',
      holidayName: 'Mahatma Gandhi Jayanti',
    });
  });

  it('accepts a custom holiday table', () => {
    expect(getMarketStatus(at(11, 0), { '2026-09-25': 'Test Day' })).toMatchObject({
      reason: 'holiday',
    });
  });
});

describe('nextSessionOpen', () => {
  const iso = (date: Date) => date.toISOString();

  it('is today 9:15 before the open, including pre-open', () => {
    expect(iso(nextSessionOpen(at(7, 0)))).toBe(iso(fromIst(2026, 9, 25, 555)));
    expect(iso(nextSessionOpen(at(9, 14)))).toBe(iso(fromIst(2026, 9, 25, 555)));
  });

  it('skips the weekend after the Friday close', () => {
    expect(iso(nextSessionOpen(at(15, 31)))).toBe(iso(fromIst(2026, 9, 28, 555)));
  });

  it('skips a holiday', () => {
    // Thursday 1 Oct after close → Friday 2 Oct is Gandhi Jayanti → Monday 5 Oct.
    expect(iso(nextSessionOpen(at(16, 0, 1, 10)))).toBe(iso(fromIst(2026, 10, 5, 555)));
  });

  it('crosses a year end', () => {
    expect(iso(nextSessionOpen(at(16, 0, 31, 12)))).toBe(iso(fromIst(2027, 1, 1, 555)));
  });

  it('fails loudly if every day is a holiday', () => {
    const everyDay = new Proxy({}, { get: () => 'Always closed' });
    expect(() => nextSessionOpen(at(16, 0), everyDay)).toThrow(/No trading day/);
  });
});

describe('holiday table', () => {
  it('lists only weekdays', () => {
    for (const key of Object.keys(nseHolidays2026)) {
      const { weekday } = toIstParts(
        fromIst(2026, Number(key.slice(5, 7)), Number(key.slice(8, 10)), 600),
      );
      expect([key, weekday !== 0 && weekday !== 6]).toEqual([key, true]);
    }
  });

  it('knows trading days', () => {
    expect(isTradingDay(fromIst(2026, 9, 25, 600))).toBe(true);
    expect(isTradingDay(fromIst(2026, 12, 25, 600))).toBe(false);
  });
});
