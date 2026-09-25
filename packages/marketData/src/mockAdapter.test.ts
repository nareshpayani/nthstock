import { Quote } from '@nthstock/contracts';
import { fixedClock, fromIst, type Clock } from '@nthstock/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAdapterContractTests } from './contractTests.js';
import { MockMarketDataAdapter, type Scheduler } from './mockAdapter.js';
import { generateSymbolMaster } from './symbolMaster.js';

const master = generateSymbolMaster();

// Friday 25 Sep 2026, 11:00 IST: NSE open.
const openClock = fixedClock(fromIst(2026, 9, 25, 11 * 60));
// Friday 2 Oct 2026, 11:00 IST: Gandhi Jayanti, a trading holiday.
const holidayClock = fixedClock(fromIst(2026, 10, 2, 11 * 60));

function movableClock(start: Date): Clock & { set(at: Date): void } {
  let now = start;
  return {
    now: () => new Date(now),
    set: (at) => {
      now = at;
    },
  };
}

function manualScheduler() {
  const callbacks = new Map<number, () => void>();
  let next = 1;
  const scheduler: Scheduler & { fire(): void; active(): number } = {
    setInterval: vi.fn((callback: () => void) => {
      callbacks.set(next, callback);
      return next++;
    }),
    clearInterval: vi.fn((handle: unknown) => {
      callbacks.delete(handle as number);
    }),
    fire: () => {
      for (const cb of [...callbacks.values()]) cb();
    },
    active: () => callbacks.size,
  };
  return scheduler;
}

runAdapterContractTests(() => new MockMarketDataAdapter({ master, clock: openClock }), {
  name: 'mock, ticked by hand',
  triggerTick: (adapter) => {
    (adapter as MockMarketDataAdapter).tick();
  },
});

runAdapterContractTests(
  () =>
    new MockMarketDataAdapter({
      master,
      clock: holidayClock,
      alwaysOpen: true,
      tickIntervalMs: 10,
    }),
  { name: 'mock, own timer, holiday with alwaysOpen' },
);

describe('MockMarketDataAdapter market hours', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits no ticks on a holiday clock', () => {
    vi.useFakeTimers();
    const adapter = new MockMarketDataAdapter({ master, clock: holidayClock });
    const listener = vi.fn();
    adapter.subscribe(['INFY', 'NIFTY50'], listener);
    vi.advanceTimersByTime(10_000);
    expect(listener).not.toHaveBeenCalled();
    expect(adapter.tick()).toBe(false);
    expect(adapter.isOpen()).toBe(false);
    adapter.dispose();
  });

  it('ticks on a holiday clock when alwaysOpen is set', () => {
    vi.useFakeTimers();
    const adapter = new MockMarketDataAdapter({ master, clock: holidayClock, alwaysOpen: true });
    const listener = vi.fn();
    adapter.subscribe(['INFY'], listener);
    vi.advanceTimersByTime(10_000);
    expect(listener).toHaveBeenCalledTimes(10);
    adapter.dispose();
    vi.advanceTimersByTime(10_000);
    expect(listener).toHaveBeenCalledTimes(10);
  });

  it.each([
    ['a weekend', fromIst(2026, 9, 26, 11 * 60)],
    ['before the open', fromIst(2026, 9, 25, 9 * 60 + 10)],
    ['after the close', fromIst(2026, 9, 25, 15 * 60 + 30)],
  ])('emits no ticks on %s', (_, at) => {
    const scheduler = manualScheduler();
    const adapter = new MockMarketDataAdapter({ master, clock: fixedClock(at), scheduler });
    const listener = vi.fn();
    adapter.subscribe(['INFY'], listener);
    for (let i = 0; i < 5; i += 1) scheduler.fire();
    expect(listener).not.toHaveBeenCalled();
  });

  it('ticks while open and moves prices on the 5-paise tick inside the band', async () => {
    const adapter = new MockMarketDataAdapter({ master, clock: openClock, tickIntervalMs: 60_000 });
    const before = Quote.parse(await adapter.getQuote('RELIANCE'));
    const seen = new Set<number>();
    for (let i = 0; i < 300; i += 1) {
      expect(adapter.tick()).toBe(true);
      const q = Quote.parse(await adapter.getQuote('RELIANCE'));
      seen.add(q.ltp);
      expect(q.ltp % 5).toBe(0);
      expect(q.ltp).toBeGreaterThanOrEqual(Math.ceil(q.prevClose * 0.8));
      expect(q.ltp).toBeLessThanOrEqual(Math.floor(q.prevClose * 1.2));
    }
    expect(seen.size).toBeGreaterThan(10);
    const after = Quote.parse(await adapter.getQuote('RELIANCE'));
    expect(after.volume).toBeGreaterThan(before.volume);
    expect(after.prevClose).toBe(before.prevClose);
  });
});

describe('MockMarketDataAdapter timers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs one timer while anyone is subscribed and clears it when the last one leaves', () => {
    const scheduler = manualScheduler();
    const adapter = new MockMarketDataAdapter({ master, clock: openClock, scheduler });
    const a = vi.fn();
    const b = vi.fn();
    const stopA = adapter.subscribe(['INFY'], a);
    const stopB = adapter.subscribe(['TCS'], b);
    expect(scheduler.setInterval).toHaveBeenCalledTimes(1);
    scheduler.fire();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    stopA();
    expect(scheduler.active()).toBe(1);
    scheduler.fire();
    expect(a).toHaveBeenCalledTimes(1);
    stopB();
    expect(scheduler.active()).toBe(0);
    expect(scheduler.clearInterval).toHaveBeenCalledTimes(1);
  });

  it('skips listeners whose symbols are all unknown', () => {
    const scheduler = manualScheduler();
    const adapter = new MockMarketDataAdapter({ master, clock: openClock, scheduler });
    const listener = vi.fn();
    adapter.subscribe(['NOSUCHSYMBOL'], listener);
    scheduler.fire();
    expect(listener).not.toHaveBeenCalled();
  });

  it('dispose stops the timer and makes later calls no-ops', () => {
    const scheduler = manualScheduler();
    const adapter = new MockMarketDataAdapter({ master, clock: openClock, scheduler });
    adapter.subscribe(['INFY'], vi.fn());
    adapter.dispose();
    adapter.dispose();
    expect(scheduler.active()).toBe(0);
    const late = vi.fn();
    const stop = adapter.subscribe(['INFY'], late);
    stop();
    expect(scheduler.setInterval).toHaveBeenCalledTimes(1);
    expect(adapter.tick()).toBe(false);
  });

  it('uses global timers by default, so fake timers apply', () => {
    vi.useFakeTimers();
    const adapter = new MockMarketDataAdapter({ master, clock: openClock, tickIntervalMs: 250 });
    const listener = vi.fn();
    const stop = adapter.subscribe(['INFY'], listener);
    vi.advanceTimersByTime(1_000);
    expect(listener).toHaveBeenCalledTimes(4);
    stop();
    vi.advanceTimersByTime(1_000);
    expect(listener).toHaveBeenCalledTimes(4);
  });
});

describe('MockMarketDataAdapter sessions', () => {
  it('rolls to a new session: last price becomes the previous close and volume resets', async () => {
    const clock = movableClock(fromIst(2026, 9, 24, 15 * 60));
    const adapter = new MockMarketDataAdapter({ master, clock });
    for (let i = 0; i < 20; i += 1) adapter.tick();
    const thursday = Quote.parse(await adapter.getQuote('INFY'));
    const niftyThursday = Quote.parse(await adapter.getQuote('NIFTY50'));

    clock.set(fromIst(2026, 9, 25, 9 * 60 + 20));
    expect(adapter.tick()).toBe(true);
    const friday = Quote.parse(await adapter.getQuote('INFY'));
    expect(friday.prevClose).toBe(thursday.ltp);
    expect(friday.open).toBe(thursday.ltp);
    expect(friday.volume).toBeLessThan(thursday.volume);
    const niftyFriday = Quote.parse(await adapter.getQuote('NIFTY50'));
    expect(niftyFriday.prevClose).toBe(niftyThursday.ltp);
    expect(Math.abs(niftyFriday.changeBp)).toBeLessThan(50);
  });

  it('starts before the open with the previous session’s moves, so movers are not empty', async () => {
    const adapter = new MockMarketDataAdapter({
      master,
      clock: fixedClock(fromIst(2026, 9, 25, 8 * 60)),
    });
    const gainers = await adapter.getMovers('NIFTY50', 'gainers');
    const losers = await adapter.getMovers('NIFTY50', 'losers');
    expect((gainers?.items.length ?? 0) + (losers?.items.length ?? 0)).toBeGreaterThan(5);
  });

  it('is deterministic for a seed and clock', async () => {
    const a = new MockMarketDataAdapter({ master, clock: openClock });
    const b = new MockMarketDataAdapter({ seed: master.seed, clock: openClock });
    for (let i = 0; i < 5; i += 1) {
      a.tick();
      b.tick();
    }
    const symbols = ['INFY', 'TCS', 'NIFTY50', 'SENSEX'];
    expect(await a.getQuotes(symbols)).toEqual(await b.getQuotes(symbols));
    expect(await a.getDepth('INFY')).toEqual(await b.getDepth('INFY'));
    expect(await a.getCandles('TCS', '1W')).toEqual(await b.getCandles('TCS', '1W'));
  });
});

describe('MockMarketDataAdapter data', () => {
  const adapter = new MockMarketDataAdapter({ master, clock: openClock });
  for (let i = 0; i < 50; i += 1) adapter.tick();

  it('moves each index in the direction of its weighted constituent change', async () => {
    for (const ix of master.indices) {
      const index = Quote.parse(await adapter.getQuote(ix.instrument.symbol));
      const quotes = await adapter.getQuotes(ix.constituents);
      const weighted = quotes.reduce((sum, q) => {
        const shares = master.equityBySymbol.get(q.symbol)?.sharesOutstanding ?? 0;
        return sum + shares * (q.ltp - q.prevClose);
      }, 0);
      expect(Math.sign(index.change)).toBe(Math.sign(weighted));
    }
  });

  it('serves the SENSEX from BSE and rejects a mismatched exchange', async () => {
    expect((await adapter.getInstrument('SENSEX'))?.exchange).toBe('BSE');
    expect(await adapter.getQuote('SENSEX', 'BSE')).not.toBeNull();
    expect(await adapter.getQuote('INFY', 'BSE')).toBeNull();
    expect(await adapter.getQuotes(['INFY', 'TCS'], 'NSE')).toHaveLength(2);
    expect(await adapter.getCandles('INFY', '1D', 'BSE')).toBeNull();
  });

  it('lists 5,005 instruments, indices first', async () => {
    const instruments = await adapter.listInstruments();
    expect(instruments).toHaveLength(master.equities.length + 5);
    expect(instruments[0]?.type).toBe('INDEX');
  });

  it('builds each curated list with 10–20 items, in its own order', async () => {
    const lists = await adapter.getStockLists();
    expect(lists.map((l) => l.id)).toEqual([
      'market-giants',
      'best-returns',
      'highest-dividends',
      'top-it',
    ]);
    for (const list of lists) {
      expect(list.items.length).toBeGreaterThanOrEqual(10);
      expect(list.items.length).toBeLessThanOrEqual(20);
    }
    const equity = (symbol: string) => master.equityBySymbol.get(symbol);
    const [giants, returns, dividends, it] = lists;
    const caps = giants?.items.map((r) => r.ltp * (equity(r.symbol)?.sharesOutstanding ?? 0)) ?? [];
    expect([...caps].sort((a, b) => b - a)).toEqual(caps);
    expect(giants?.items[0]?.symbol).toBe('RELIANCE');
    const r1y = returns?.items.map((r) => equity(r.symbol)?.return1yBp ?? 0) ?? [];
    expect([...r1y].sort((a, b) => b - a)).toEqual(r1y);
    const yields = dividends?.items.map((r) => equity(r.symbol)?.dividendYieldBp ?? 0) ?? [];
    expect([...yields].sort((a, b) => b - a)).toEqual(yields);
    expect(it?.items.every((r) => equity(r.symbol)?.sector === 'Information Technology')).toBe(
      true,
    );
    expect(it?.items[0]?.symbol).toBe('TCS');
  });

  it('sorts gainers descending by % change for every index', async () => {
    for (const ix of master.indices) {
      const movers = await adapter.getMovers(ix.instrument.symbol, 'gainers', 50);
      const bps = movers?.items.map((r) => r.changeBp) ?? [];
      expect(bps.length).toBeGreaterThan(0);
      expect([...bps].sort((a, b) => b - a)).toEqual(bps);
      for (const r of movers?.items ?? []) expect(ix.constituents).toContain(r.symbol);
    }
    expect((await adapter.getMovers('NIFTY50', 'losers'))?.items.length).toBeLessThanOrEqual(10);
    expect(await adapter.getMovers('INFY', 'gainers')).toBeNull();
  });

  it('gives index candles and sparklines that end at the current level', async () => {
    const nifty = Quote.parse(await adapter.getQuote('NIFTY50'));
    for (const range of ['1D', '1W', '1M', '1Y', '5Y'] as const) {
      const series = await adapter.getCandles('NIFTY50', range);
      expect(series?.candles.at(-1)?.c).toBe(nifty.ltp);
    }
    const summary = (await adapter.getIndices()).find((s) => s.symbol === 'NIFTY50');
    expect(summary?.value).toBe(nifty.ltp);
    expect(summary?.sparkline.at(-1)).toBe(nifty.ltp);
    expect((await adapter.getCandles('NIFTY50', '1D'))?.candles[0]?.o).toBe(nifty.open);
    expect(summary?.sparkline.length).toBeLessThanOrEqual(400);
  });

  it('keeps stats consistent: 52-week range covers today, market cap follows the LTP', async () => {
    const stats = await adapter.getStats('INFY');
    const quote = Quote.parse(await adapter.getQuote('INFY'));
    const shares = master.equityBySymbol.get('INFY')?.sharesOutstanding ?? 0;
    expect(stats?.marketCap).toBe(quote.ltp * shares);
    expect(stats?.week52High).toBeGreaterThanOrEqual(quote.high);
    expect(stats?.week52Low).toBeLessThanOrEqual(quote.low);
    expect(await adapter.getStats('NIFTY50')).toBeNull();
    const loss = master.equities.find((e) => e.peX100 === null);
    expect((await adapter.getStats(loss?.instrument.symbol ?? ''))?.peX100).toBeNull();
  });

  it('searches through the index', async () => {
    expect((await adapter.search('inf'))[0]?.symbol).toBe('INFY');
  });
});
