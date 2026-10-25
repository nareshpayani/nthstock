import { generateSymbolMaster, MockMarketDataAdapter } from '@nthstock/marketData';
import { fixedClock } from '@nthstock/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { createDeps } from '../deps.js';
import { createMemoryPublisher } from './publisher.js';
import { startQuoteStreams, type QuoteStreams } from './quoteStreams.js';

// Nothing listens on port 1, so these are the "Redis is down" paths of NSTOCK-0354.
const DEAD_REDIS = 'redis://127.0.0.1:1';
const master = generateSymbolMaster({ equityCount: 20 });
const SYMBOL = master.equities[0]?.instrument.symbol ?? '';
const manualScheduler = { setInterval: () => 0, clearInterval: () => undefined };
const clock = fixedClock('2026-09-28T04:30:00.000Z');
const newMarket = (externalTicks: boolean) =>
  new MockMarketDataAdapter({
    master,
    clock,
    alwaysOpen: true,
    externalTicks,
    scheduler: manualScheduler,
  });

const openStreams: QuoteStreams[] = [];
afterEach(async () => {
  for (const streams of openStreams.splice(0)) await streams.close();
});

describe('startQuoteStreams with Redis down', () => {
  it('falls back to the adapter for known symbols and leaves unknown ones out, in order', async () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    const market = newMarket(true);
    const streams = startQuoteStreams(market, { url: DEAD_REDIS, shards: 2, log });
    openStreams.push(streams);
    const second = master.equities[1]?.instrument.symbol ?? '';

    const quotes = await streams.getQuotes([second, 'NOSUCHSYMBOL', SYMBOL]);

    expect(quotes.map((quote) => quote.symbol)).toEqual([second, SYMBOL]);
    expect(quotes[1]).toEqual(await market.getQuote(SYMBOL));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('read failed for 2 symbols'));
  });

  it('returns nothing, and makes no Redis call, for no known symbol', async () => {
    const streams = startQuoteStreams(newMarket(true), {
      url: DEAD_REDIS,
      shards: 1,
      log: { info: vi.fn(), warn: vi.fn() },
    });
    openStreams.push(streams);

    expect(await streams.getQuotes(['NOSUCHSYMBOL'])).toEqual([]);
  });

  it('lets app.ready() resolve after the snapshot wait times out', async () => {
    const market = newMarket(true);
    const app = buildApp({
      deps: { clock, market, quoteStreams: { url: DEAD_REDIS, shards: 1, log: console } },
      orderSweepMs: null,
    });
    const error = vi.spyOn(app.log, 'error');

    await app.ready();

    expect(error).toHaveBeenCalledWith(expect.stringContaining('not reachable'));
    await app.close();
    market.dispose();
  }, 15_000);
});

describe('createDeps and the tick pump', () => {
  it('turns externalTicks on only with quoteStreams', async () => {
    const withStreams = createDeps({
      clock,
      quoteStreams: { url: DEAD_REDIS, shards: 1, log: { info: vi.fn(), warn: vi.fn() } },
    });
    const without = createDeps({ clock });

    expect(withStreams.quoteStreams).not.toBeNull();
    expect(without.quoteStreams).toBeNull();
    expect(withStreams.market).toBeInstanceOf(MockMarketDataAdapter);
    expect((withStreams.market as MockMarketDataAdapter).applyQuotes).toBeTypeOf('function');
    await withStreams.dispose();
    await without.dispose();
  });

  it('refuses quoteStreams with a market that cannot take the quotes', () => {
    const market = { ...newMarket(false), getQuote: vi.fn() };
    Object.setPrototypeOf(market, Object.prototype);

    expect(() =>
      createDeps({
        clock,
        market: market as never,
        quoteStreams: { url: DEAD_REDIS, shards: 1, log: { info: vi.fn(), warn: vi.fn() } },
      }),
    ).toThrow('quoteStreams needs a MockMarketDataAdapter');
  });

  it('still starts the tick pump when there are no quoteStreams', async () => {
    const market = newMarket(false);
    const publisher = createMemoryPublisher();
    const app = buildApp({
      deps: { clock, market },
      tickPublisher: publisher,
      orderSweepMs: null,
    });
    await app.ready();

    market.tick();
    await vi.waitFor(() => expect(publisher.messages.length).toBeGreaterThan(0));
    await app.close();
    market.dispose();
  });
});
