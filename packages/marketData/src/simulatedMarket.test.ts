import { Candle, Quote } from '@nthstock/contracts';
import { fromIst, type Clock } from '@nthstock/utils';
import { describe, expect, it, vi } from 'vitest';
import { MockMarketDataAdapter, NUDGE_TICKS, type Scheduler } from './mockAdapter.js';
import { generateSymbolMaster } from './symbolMaster.js';

// SPEC-TFC-1 §6.7 and TFC-11, PLAN-TFC-1 T07: per-instrument streams, the 250 ms focus lane,
// timestamped catch-up replay, tick-built 1-minute bars, nudge and gap.

// This package is isomorphic (no Node types); the timing test only needs process.cpuUsage.
interface CpuUsage {
  user: number;
  system: number;
}
declare const process: { cpuUsage(previous?: CpuUsage): CpuUsage };

const master = generateSymbolMaster();
const [A, B] = master.equities.map((e) => e.instrument.symbol) as [string, string];

/** Friday 25 Sep 2026, 11:00 IST: NSE open. */
const START = fromIst(2026, 9, 25, 11 * 60);

function movableClock(start: Date): Clock & { advance(ms: number): void } {
  let now = start.getTime();
  return {
    now: () => new Date(now),
    advance: (ms) => {
      now += ms;
    },
  };
}

/** A scheduler the test fires by hand; it remembers the interval it was asked for. */
function manualScheduler() {
  let callback: (() => void) | null = null;
  let intervalMs = 0;
  const scheduler: Scheduler & { fire(): void; intervalMs(): number } = {
    setInterval: vi.fn((cb: () => void, ms: number) => {
      callback = cb;
      intervalMs = ms;
      return 1;
    }),
    clearInterval: vi.fn(() => {
      callback = null;
    }),
    fire: () => {
      callback?.();
    },
    intervalMs: () => intervalMs,
  };
  return scheduler;
}

function setup(options: { replayLimitMs?: number } = {}) {
  const clock = movableClock(START);
  const scheduler = manualScheduler();
  const adapter = new MockMarketDataAdapter({ master, clock, scheduler, ...options });
  const batches: Quote[][] = [];
  adapter.subscribe([A, B], (quotes) => batches.push([...quotes]));
  return { adapter, clock, scheduler, batches };
}

const ltpOf = async (adapter: MockMarketDataAdapter, symbol: string) =>
  (await adapter.getQuote(symbol))?.ltp ?? 0;

describe('per-instrument random streams', () => {
  it('gives each instrument a path that does not depend on how others tick', async () => {
    const plain = setup();
    const focused = setup();
    focused.adapter.focus(B); // B now takes four times as many draws
    for (let i = 0; i < 5; i += 1) {
      plain.clock.advance(1_000);
      plain.scheduler.fire();
      for (let beat = 0; beat < 4; beat += 1) {
        focused.clock.advance(250);
        focused.scheduler.fire();
      }
    }
    expect(await ltpOf(focused.adapter, A)).toBe(await ltpOf(plain.adapter, A));
  }, 30_000); // builds two adapters over the full symbol master; CI under coverage can pass 5 s
});

describe('the focus lane (TFC-11)', () => {
  it('ticks the focused instrument every 250 ms and the rest every second', () => {
    const { adapter, clock, scheduler, batches } = setup();
    expect(scheduler.intervalMs()).toBe(1_000);
    adapter.focus(A);
    expect(adapter.focusedSymbol()).toBe(A);
    expect(scheduler.intervalMs()).toBe(250);

    for (let beat = 0; beat < 8; beat += 1) {
      clock.advance(250);
      scheduler.fire();
    }
    const ticksOf = (symbol: string) =>
      batches.flat().filter((quote) => quote.symbol === symbol).length;
    expect(ticksOf(A)).toBe(8);
    expect(ticksOf(B)).toBe(2);

    adapter.focus(null);
    expect(scheduler.intervalMs()).toBe(1_000);
    adapter.focus('NOT-A-SYMBOL');
    expect(adapter.focusedSymbol()).toBeNull();
  });
});

describe('catch-up replay (§6.7)', () => {
  it('replays the missed ticks of a replay instrument once, in order, with timestamps', () => {
    const { adapter, clock, scheduler, batches } = setup();
    adapter.setReplaySymbols([A]);
    clock.advance(5 * 60_000);
    scheduler.fire();

    const aTicks = batches.flat().filter((quote) => quote.symbol === A);
    expect(aTicks).toHaveLength(300);
    expect(aTicks.map((quote) => Date.parse(quote.ts) - START.getTime())).toEqual(
      Array.from({ length: 300 }, (_, k) => (k + 1) * 1_000),
    );
    for (const quote of aTicks) expect(Quote.safeParse(quote).success).toBe(true);
    // B is not in the replay set: one exact step, at the current time.
    const bTicks = batches.flat().filter((quote) => quote.symbol === B);
    expect(bTicks.map((quote) => quote.ts)).toEqual([clock.now().toISOString()]);

    // Batches arrive in time order, and nothing is replayed twice.
    const times = batches.map((batch) => Date.parse((batch[0] as Quote).ts));
    expect(times).toEqual([...times].sort((x, y) => x - y));
    batches.length = 0;
    clock.advance(1_000);
    scheduler.fire();
    expect(batches.flat().filter((quote) => quote.symbol === A)).toHaveLength(1);
  });

  it('ticks once when the timer is up to two intervals late', () => {
    const { adapter, clock, scheduler, batches } = setup();
    adapter.setReplaySymbols([A]);
    clock.advance(2_000);
    scheduler.fire();
    expect(batches.flat().filter((quote) => quote.symbol === A)).toHaveLength(1);
  });

  it('moves a gap longer than the replay limit in one step', () => {
    const { adapter, clock, scheduler, batches } = setup();
    adapter.setReplaySymbols([A]);
    clock.advance(31 * 60_000);
    scheduler.fire();
    expect(batches.flat().filter((quote) => quote.symbol === A)).toHaveLength(1);
  });

  it('replays 30 minutes of one instrument in under 100 ms', () => {
    // A unit benchmark (SPEC-TFC-1 §15), timed like the symbol master's: CPU time, best of three
    // after a warm-up. CI runs every package's tests at once on a few cores, and waiting for a
    // core is not replay cost.
    const replay = (): number => {
      const { adapter, clock, scheduler, batches } = setup();
      adapter.setReplaySymbols([A]);
      clock.advance(30 * 60_000);
      const start = process.cpuUsage();
      scheduler.fire();
      const used = process.cpuUsage(start);
      expect(batches.flat().filter((quote) => quote.symbol === A)).toHaveLength(1_800);
      return (used.user + used.system) / 1_000;
    };
    replay();
    expect(Math.min(replay(), replay(), replay())).toBeLessThan(100);
    // Four setups (one warm-up, three timed) can exceed vitest's 5 s default on a loaded CI runner;
    // only the CPU time inside fire() is held to 100 ms.
  }, 30_000);

  it('replays the focused instrument at its 250 ms beat', () => {
    const { adapter, clock, scheduler, batches } = setup();
    adapter.focus(A);
    adapter.setReplaySymbols([A]);
    clock.advance(60_000);
    scheduler.fire();
    expect(batches.flat().filter((quote) => quote.symbol === A)).toHaveLength(240);
  });

  it('does not replay time the feed sat idle with no subscriber', () => {
    const clock = movableClock(START);
    const scheduler = manualScheduler();
    const adapter = new MockMarketDataAdapter({ master, clock, scheduler });
    adapter.setReplaySymbols([A]);
    clock.advance(10 * 60_000);
    const batches: Quote[][] = [];
    adapter.subscribe([A], (quotes) => batches.push([...quotes]));
    clock.advance(1_000);
    scheduler.fire();
    expect(batches.flat()).toHaveLength(1);
  });
});

describe('tick-built 1-minute bars in the 1D candles', () => {
  it('ends the 1D series with bars built from the ticks, high and low included', async () => {
    const { adapter, clock, scheduler } = setup();
    adapter.setReplaySymbols([A]);
    const seen: number[] = [];
    adapter.subscribe([A], (quotes) => {
      for (const quote of quotes) seen.push(quote.ltp);
    });
    clock.advance(3 * 60_000);
    scheduler.fire();

    const series = await adapter.getCandles(A, '1D');
    if (!series) throw new Error('expected candles');
    for (const candle of series.candles) expect(Candle.safeParse(candle).success).toBe(true);
    const times = series.candles.map((candle) => Date.parse(candle.t));
    expect(new Set(times).size).toBe(times.length);
    expect(times).toEqual([...times].sort((x, y) => x - y));

    const built = series.candles.filter((candle) => Date.parse(candle.t) >= START.getTime());
    expect(built.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...built.map((candle) => candle.h))).toBe(Math.max(...seen));
    expect(Math.min(...built.map((candle) => candle.l))).toBe(Math.min(...seen));
    expect(series.candles.at(-1)?.c).toBe(await ltpOf(adapter, A));
    // The generated part leads into the first built bar without a jump.
    const firstBuilt = series.candles.findIndex(
      (candle) => Date.parse(candle.t) >= START.getTime(),
    );
    expect(series.candles[firstBuilt - 1]?.c).toBe(series.candles[firstBuilt]?.o);
  });

  it('leaves the 1D candles generated for an instrument nobody watched', async () => {
    const { adapter, clock, scheduler } = setup();
    const quiet = master.equities[2]?.instrument.symbol ?? '';
    clock.advance(1_000);
    scheduler.fire();
    const series = await adapter.getCandles(quiet, '1D');
    expect(series?.candles.at(-1)?.c).toBe(await ltpOf(adapter, quiet));
  });
});

describe('nudge and gap (the demo Simulator)', () => {
  it(`nudge moves the price by the ratio over ${String(NUDGE_TICKS)} ticks, on top of the walk`, async () => {
    const plain = setup();
    const nudged = setup();
    expect(nudged.adapter.nudge(A, 0.01)).toBe(true);
    for (let i = 0; i < NUDGE_TICKS + 2; i += 1) {
      for (const run of [plain, nudged]) {
        run.clock.advance(1_000);
        run.scheduler.fire();
      }
    }
    const expected = (await ltpOf(plain.adapter, A)) * 1.01;
    expect(Math.abs((await ltpOf(nudged.adapter, A)) - expected)).toBeLessThanOrEqual(5);
    expect(await ltpOf(nudged.adapter, B)).toBe(await ltpOf(plain.adapter, B));
  });

  it('gap moves the price at once and sends the tick to subscribers', async () => {
    const { adapter, batches } = setup();
    const before = await ltpOf(adapter, A);
    const quote = adapter.gap(A, -0.03);
    expect(quote?.ltp).toBeGreaterThanOrEqual(Math.round((before * 0.97) / 5) * 5 - 5);
    expect(quote?.ltp).toBeLessThanOrEqual(Math.round((before * 0.97) / 5) * 5 + 5);
    expect(batches.at(-1)?.find((q) => q.symbol === A)?.ltp).toBe(quote?.ltp);
    expect(await ltpOf(adapter, A)).toBe(quote?.ltp);
  });

  it('refuses unknown symbols, indices, impossible ratios and a closed market', () => {
    const { adapter } = setup();
    const index = master.indices[0]?.instrument.symbol ?? '';
    expect(adapter.nudge('NOPE', 0.01)).toBe(false);
    expect(adapter.nudge(index, 0.01)).toBe(false);
    expect(adapter.gap(index, 0.01)).toBeNull();
    expect(() => adapter.gap(A, -1)).toThrow(RangeError);
    expect(() => adapter.nudge(A, Number.NaN)).toThrow(RangeError);

    const closed = new MockMarketDataAdapter({
      master,
      clock: { now: () => fromIst(2026, 9, 25, 20 * 60) },
    });
    expect(closed.gap(A, 0.01)).toBeNull();
  });
});
