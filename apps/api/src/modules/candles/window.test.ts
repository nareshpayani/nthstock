import type { Candle, Quote } from '@nthstock/contracts';
import { candleTimes } from '@nthstock/marketData';
import { fixedClock, fromIst } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import { candleWindow, dropDailyOnlySessions, withLiveQuote, type CandleWindow } from './window.js';

// Wednesday 21 Oct 2026, 11:02 IST: in session, the day after Dussehra (Tue 20 Oct, a holiday).
const inSession = fixedClock(fromIst(2026, 10, 21, 11 * 60 + 2));
// Saturday 3 Oct 2026: closed; Friday 2 Oct is Gandhi Jayanti, so the last session is Thu 1 Oct.
const weekend = fixedClock(fromIst(2026, 10, 3, 12 * 60));
const ist = (day: number, minuteOfDay: number, month = 10) =>
  fromIst(2026, month, day, minuteOfDay).toISOString();
const iso = (window: CandleWindow) => ({
  stored: window.stored,
  interval: window.interval,
  from: window.from.toISOString(),
  to: window.to.toISOString(),
  forming: window.forming.toISOString(),
  live: window.live,
});

describe('candleWindow', () => {
  it('1D in session: today from 9:15 up to the minute containing now', () => {
    expect(iso(candleWindow('1D', undefined, inSession))).toEqual({
      stored: '1m',
      interval: '1m',
      from: ist(21, 555),
      to: ist(21, 663),
      forming: ist(21, 662),
      live: true,
    });
  });

  it('maps a longer bar size to its aggregate and its forming bucket from 9:15', () => {
    expect(candleWindow('1D', '15m', inSession)).toMatchObject({
      stored: '15m',
      forming: new Date(ist(21, 660)),
    });
    expect(candleWindow('1D', '30m', inSession).forming.toISOString()).toBe(ist(21, 645));
    // Hourly bars run 9:15, 10:15, …: 11:02 is in the 10:15 bar.
    expect(candleWindow('1W', '1h', inSession).forming.toISOString()).toBe(ist(21, 615));
    expect(candleWindow('1W', undefined, inSession)).toMatchObject({
      stored: '5m',
      forming: new Date(ist(21, 660)),
      to: new Date(ist(21, 665)),
    });
  });

  it('spans the generator sessions: 1W five, 1M twenty-two', () => {
    for (const range of ['1D', '1W', '1M'] as const) {
      const times = candleTimes(range, inSession);
      expect(candleWindow(range, undefined, inSession).from).toEqual(times[0]);
    }
    // Five sessions back from Wed 21 Oct, skipping Tue 20: Wed 14 Oct.
    expect(candleWindow('1W', undefined, inSession).from.toISOString()).toBe(ist(14, 555));
    expect(candleWindow('1M', '1d', inSession)).toMatchObject({
      stored: '1d',
      interval: '1d',
      forming: new Date(ist(21, 555)),
    });
  });

  it('1Y and 5Y read days up to the latest session, 1w as grouped days', () => {
    expect(iso(candleWindow('1Y', undefined, inSession))).toMatchObject({
      stored: '1d',
      interval: '1d',
      from: candleTimes('1Y', inSession)[0]?.toISOString(),
      to: ist(22, 555),
      forming: ist(21, 555),
    });
    expect(candleWindow('1Y', '1w', inSession)).toMatchObject({ stored: '1d', interval: '1w' });
    expect(candleWindow('5Y', undefined, inSession)).toMatchObject({
      stored: '1d',
      interval: '1w',
      from: candleTimes('5Y', inSession)[0],
    });
  });

  it('when closed, ends with the last bar of the last session', () => {
    expect(iso(candleWindow('1D', undefined, weekend))).toEqual({
      stored: '1m',
      interval: '1m',
      from: ist(1, 555),
      to: ist(1, 930),
      forming: ist(1, 929),
      live: false,
    });
    expect(candleWindow('1D', '1h', weekend).forming.toISOString()).toBe(ist(1, 915));
  });
});

const bar = (t: string, c = 100): Candle => ({ t, o: c, h: c + 5, l: c - 5, c, v: 10 });

describe('dropDailyOnlySessions', () => {
  it('drops a session whose only bar is its 9:15 row, and keeps real minutes', () => {
    const window = candleWindow('1W', undefined, inSession);
    const bars = [bar(ist(14, 555)), bar(ist(15, 555)), bar(ist(15, 560)), bar(ist(16, 600))];
    expect(dropDailyOnlySessions(bars, window)).toEqual(bars.slice(1));
  });

  it('keeps the forming session while it trades, and every daily bar', () => {
    const live = candleWindow('1D', undefined, fixedClock(fromIst(2026, 10, 21, 556)));
    expect(dropDailyOnlySessions([bar(ist(21, 555))], live)).toHaveLength(1);
    const closed = candleWindow('1D', undefined, weekend);
    expect(dropDailyOnlySessions([bar(ist(1, 555))], closed)).toEqual([]);
    const days = [bar(ist(14, 555)), bar(ist(15, 555))];
    expect(dropDailyOnlySessions(days, candleWindow('1Y', undefined, inSession))).toEqual(days);
  });
});

describe('withLiveQuote', () => {
  const quote = (ltp: number, at = inSession.now()): Quote => ({
    token: 1,
    symbol: 'INFY',
    exchange: 'NSE',
    ltp,
    change: 0,
    changeBp: 0,
    open: 98,
    high: 120,
    low: 90,
    prevClose: 100,
    volume: 5_000,
    ts: at.toISOString(),
  });
  const window = candleWindow('1D', undefined, inSession);

  it('widens the stored forming bar to the LTP and closes it there', () => {
    const bars = [bar(ist(21, 661)), bar(ist(21, 662))];
    expect(withLiveQuote(bars, quote(130), window).at(-1)).toEqual({
      t: ist(21, 662),
      o: 100,
      h: 130,
      l: 95,
      c: 130,
      v: 10,
    });
    expect(withLiveQuote(bars, quote(80), window).at(-1)).toMatchObject({ h: 105, l: 80, c: 80 });
    // The input is not changed.
    expect(bars[1]?.c).toBe(100);
  });

  it('opens a new forming bar at the previous close', () => {
    const bars = [bar(ist(21, 600))];
    expect(withLiveQuote(bars, quote(103), window)).toEqual([
      bars[0],
      { t: ist(21, 662), o: 100, h: 103, l: 100, c: 103, v: 0 },
    ]);
  });

  it("opens a new daily bar from the quote's day", () => {
    const days = candleWindow('1Y', undefined, inSession);
    expect(withLiveQuote([bar(ist(19, 555))], quote(110), days).at(-1)).toEqual({
      t: ist(21, 555),
      o: 98,
      h: 120,
      l: 90,
      c: 110,
      v: 5_000,
    });
    const noDay = { ...quote(110), open: 0, low: 0 };
    expect(withLiveQuote([], noDay, days)).toEqual([
      { t: ist(21, 555), o: 110, h: 120, l: 110, c: 110, v: 5_000 },
    ]);
  });

  it('leaves the bars alone without a quote, with an older quote, or past the forming bar', () => {
    const bars = [bar(ist(21, 662))];
    expect(withLiveQuote(bars, null, window)).toEqual(bars);
    expect(withLiveQuote(bars, quote(130, new Date(ist(21, 600))), window)).toEqual(bars);
    const later = [bar(ist(21, 700))];
    expect(withLiveQuote(later, quote(130), window)).toEqual(later);
  });
});
