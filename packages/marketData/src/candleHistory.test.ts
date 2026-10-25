import { Candle } from '@nthstock/contracts';
import { fromIst, isTradingDay, istDateKey, toIstParts } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import {
  defaultMinuteSymbols,
  equityGbm,
  historyCalendar,
  instrumentHistory,
  latestClosedSessionOpen,
  sessionMinuteBars,
} from './candleHistory.js';
import { generateSymbolMaster } from './symbolMaster.js';
import { SESSION_MINUTES } from './ticks.js';

const master = generateSymbolMaster({ equityCount: 300 });
// Wednesday 21 Oct 2026, 11:00 IST: the day after Dussehra (Tue 20 Oct, a holiday).
const inSession = fromIst(2026, 10, 21, 11 * 60);
const calendar = historyCalendar(inSession);

describe('latestClosedSessionOpen', () => {
  it('is the previous trading day while a session runs, skipping holidays', () => {
    expect(istDateKey(latestClosedSessionOpen(inSession))).toBe('2026-10-19');
  });

  it('is today once 15:30 IST has passed', () => {
    const open = latestClosedSessionOpen(fromIst(2026, 10, 21, 15 * 60 + 30));
    expect(open.toISOString()).toBe(fromIst(2026, 10, 21, 9 * 60 + 15).toISOString());
  });

  it('skips the weekend back to the last trading day', () => {
    // Saturday 3 Oct 2026; Friday 2 Oct is Gandhi Jayanti.
    expect(istDateKey(latestClosedSessionOpen(fromIst(2026, 10, 3, 12 * 60)))).toBe('2026-10-01');
  });

  it('fails loudly on a calendar with no trading days', () => {
    const everyDay: Record<string, string> = {};
    for (let d = 0; d < 400; d += 1) {
      everyDay[istDateKey(new Date(Date.UTC(2025, 8, 1) + d * 86_400_000))] = 'closed';
    }
    expect(() => latestClosedSessionOpen(fromIst(2026, 9, 25, 600), everyDay)).toThrow();
  });
});

describe('historyCalendar', () => {
  it('covers two years of trading sessions, ending with the as-of session', () => {
    expect(calendar.asOf.toISOString()).toBe(fromIst(2026, 10, 19, 555).toISOString());
    expect(calendar.daily.at(-1)).toEqual(calendar.asOf);
    expect(istDateKey(calendar.daily[0] as Date) > '2024-10-19').toBe(true);
    expect(istDateKey(calendar.daily[0] as Date) <= '2024-10-23').toBe(true);
    expect(calendar.daily.length).toBeGreaterThan(500);
    expect(calendar.daily.length).toBeLessThan(530);
    for (const open of calendar.daily) {
      expect(isTradingDay(open)).toBe(true);
      expect(toIstParts(open).minuteOfDay).toBe(555);
    }
  });

  it('gives minute bars to the sessions of the last 30 days, at least 22 of them', () => {
    expect(calendar.minute).toEqual(calendar.daily.slice(-calendar.minute.length));
    expect(calendar.minute.length).toBeGreaterThanOrEqual(22);
    const since = calendar.asOf.getTime() - 30 * 86_400_000;
    const first = calendar.minute[0] as Date;
    // Either the 30-day window, or reached back further to hold 22 sessions.
    expect(first.getTime() > since || calendar.minute.length === 22).toBe(true);
    expect(historyCalendar(inSession, { minuteDays: 3 }).minute).toHaveLength(22);
    expect(historyCalendar(inSession, { minuteDays: 4, minMinuteSessions: 1 }).minute).toHaveLength(
      2,
    );
  });
});

describe('instrumentHistory', () => {
  const infy = instrumentHistory(master, 'INFY', calendar, { minutes: true });
  const equity = master.equityBySymbol.get('INFY');

  it('is null for an unknown symbol', () => {
    expect(instrumentHistory(master, 'NOPE', calendar, { minutes: true })).toBeNull();
  });

  it('gives one valid daily bar a session, each opening at the previous close', () => {
    expect(infy?.token).toBe(equity?.instrument.token);
    const daily = infy?.daily ?? [];
    expect(daily.map((bar) => bar.t)).toEqual(calendar.daily.map((d) => d.toISOString()));
    for (const [k, bar] of daily.entries()) {
      Candle.parse(bar);
      expect(bar.o % 5).toBe(0);
      if (k > 0) expect(bar.o).toBe(daily[k - 1]?.c);
      expect(bar.v).toBeGreaterThan(0);
    }
  });

  it('ends at the previous close and passes the one-year return a year back', () => {
    const daily = infy?.daily ?? [];
    expect(daily.at(-1)?.c).toBe(equity?.basePrice);
    const yearAgo = fromIst(2025, 10, 19, 555).getTime();
    const pivot = daily.findIndex((bar) => Date.parse(bar.t) > yearAgo);
    const anchor = (equity?.basePrice ?? 0) / (1 + (equity?.return1yBp ?? 0) / 10_000);
    expect(Math.abs((daily[pivot - 1]?.c ?? 0) - anchor)).toBeLessThanOrEqual(5);
  });

  it('bridges each minute session from the day open to the day close', () => {
    const minutes = infy?.minutes ?? [];
    expect(minutes).toHaveLength(calendar.minute.length * SESSION_MINUTES);
    const first = calendar.daily.length - calendar.minute.length;
    for (const [s, open] of calendar.minute.entries()) {
      const day = infy?.daily[first + s];
      const session = minutes.slice(s * SESSION_MINUTES, (s + 1) * SESSION_MINUTES);
      expect(session[0]?.t).toBe(open.toISOString());
      expect(session[0]?.o).toBe(day?.o);
      expect(session.at(-1)?.c).toBe(day?.c);
      expect(Date.parse(session.at(-1)?.t ?? '') - open.getTime()).toBe(374 * 60_000);
    }
    for (const bar of minutes.slice(0, 2_000)) Candle.parse(bar);
  });

  it('is the same on every run, and leaves minutes out unless asked', () => {
    expect(instrumentHistory(master, 'INFY', calendar, { minutes: true })).toEqual(infy);
    const other = generateSymbolMaster({ equityCount: 300 });
    expect(instrumentHistory(other, 'INFY', calendar, { minutes: false })?.daily).toEqual(
      infy?.daily,
    );
    expect(instrumentHistory(master, 'INFY', calendar, { minutes: false })?.minutes).toEqual([]);
  });

  it('gives an index its level on a 1-point-hundredth step with no volume', () => {
    const nifty = instrumentHistory(master, 'NIFTY50', calendar, { minutes: true });
    expect(nifty?.daily.at(-1)?.c).toBe(master.indexBySymbol.get('NIFTY50')?.baseLevel);
    expect(nifty?.daily.every((bar) => bar.v === 0)).toBe(true);
    expect(nifty?.minutes).toHaveLength(calendar.minute.length * SESSION_MINUTES);
  });

  it('works for a history shorter than a year', () => {
    const short = historyCalendar(inSession, { years: 0.25 });
    // Three months: 20 Jul to 19 Oct 2026, about 64 sessions.
    expect(short.daily.length).toBeGreaterThan(55);
    expect(short.daily.length).toBeLessThan(70);
    const bars = instrumentHistory(master, 'INFY', short, { minutes: false })?.daily ?? [];
    expect(bars).toHaveLength(short.daily.length);
    expect(bars.at(-1)?.c).toBe(equity?.basePrice);
  });
});

describe('sessionMinuteBars', () => {
  it('spreads the day volume over 375 minutes from 9:15', () => {
    const open = fromIst(2026, 10, 19, 555);
    const day = {
      t: open.toISOString(),
      o: 100_000,
      h: 103_000,
      l: 99_000,
      c: 101_000,
      v: 375_000,
    };
    const bars = sessionMinuteBars({ open, day, volatility: 0.25, seed: 7 });
    expect(bars).toHaveLength(375);
    const volume = bars.reduce((sum, bar) => sum + bar.v, 0);
    expect(volume).toBeGreaterThan(375_000 * 0.8);
    expect(volume).toBeLessThan(375_000 * 1.2);
  });
});

describe('defaultMinuteSymbols', () => {
  it('holds the indices and the large caps of the main indices', () => {
    const symbols = defaultMinuteSymbols(master);
    expect(symbols.slice(0, master.indices.length)).toEqual(
      master.indices.map((index) => index.instrument.symbol),
    );
    expect(symbols).toEqual(expect.arrayContaining(['NIFTY50', 'SENSEX', 'INFY', 'HDFCBANK']));
    expect(new Set(symbols).size).toBe(symbols.length);
    expect(symbols.length).toBeLessThan(100);
  });
});

describe('equityGbm', () => {
  it('scales the sector volatility for mid and small caps', () => {
    const large = master.equities.find((e) => e.capBucket === 'LARGE');
    const small = master.equities.find((e) => e.capBucket === 'SMALL');
    const mid = master.equities.find((e) => e.capBucket === 'MID');
    expect(large && equityGbm(large).volatility).toBeGreaterThan(0);
    if (small) {
      expect(equityGbm(small).volatility).toBeCloseTo(
        equityGbm({ ...small, capBucket: 'LARGE' }).volatility * 1.4,
      );
    }
    if (mid) {
      expect(equityGbm(mid).volatility).toBeCloseTo(
        equityGbm({ ...mid, capBucket: 'LARGE' }).volatility * 1.2,
      );
    }
  });
});
