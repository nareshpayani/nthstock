import { TICKS_CHANNEL, TickBatch } from '@nthstock/contracts';
import { generateSymbolMaster, MockMarketDataAdapter } from '@nthstock/marketData';
import { fixedClock } from '@nthstock/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryPublisher } from './publisher.js';
import { startTickPump } from './tickPump.js';

const master = generateSymbolMaster({ equityCount: 60 });
const manualScheduler = { setInterval: () => 0, clearInterval: () => undefined };
const log = { info: vi.fn(), warn: vi.fn() };

const adapter = () =>
  new MockMarketDataAdapter({
    master,
    clock: fixedClock('2026-09-25T05:00:00.000Z'),
    alwaysOpen: true,
    scheduler: manualScheduler,
  });

const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.clearAllMocks();
});

describe('startTickPump', () => {
  it('publishes each tick as one TickBatch per exchange covering the whole master', async () => {
    const market = adapter();
    const publisher = createMemoryPublisher();
    const pump = await startTickPump({ market, publisher, log });
    market.tick();
    await flushPromises();
    expect(publisher.messages.map((m) => m.channel)).toEqual([TICKS_CHANNEL, TICKS_CHANNEL]);
    const batches = publisher.messages.map((m) => TickBatch.parse(JSON.parse(m.message)));
    const symbols = batches.flatMap((b) => b.quotes.map((q) => q.symbol));
    expect(new Set(symbols).size).toBe((await market.listInstruments()).length);
    expect(symbols).toContain('INFY');
    expect(symbols).toContain('SENSEX');
    pump.stop();
    pump.stop();
    market.tick();
    await flushPromises();
    expect(publisher.messages).toHaveLength(2);
    market.dispose();
  });

  it('uses a custom channel', async () => {
    const market = adapter();
    const publisher = createMemoryPublisher();
    const pump = await startTickPump({ market, publisher, log, channel: 'test:ticks' });
    market.tick();
    await flushPromises();
    expect(publisher.messages[0]?.channel).toBe('test:ticks');
    pump.stop();
    market.dispose();
  });

  it('logs a publishing outage once and its recovery once', async () => {
    const market = adapter();
    const publisher = createMemoryPublisher();
    const pump = await startTickPump({ market, publisher, log });
    publisher.fail(new Error('connection refused'));
    market.tick();
    market.tick();
    await flushPromises();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith('Tick publishing failed: connection refused');
    publisher.fail(null);
    market.tick();
    market.tick();
    await flushPromises();
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith('Tick publishing recovered');
    pump.stop();
    market.dispose();
  });

  it('skips empty batches and reports non-Error failures', async () => {
    const listeners: ((quotes: readonly unknown[]) => void)[] = [];
    const market = {
      listInstruments: () => Promise.resolve([{ symbol: 'INFY', exchange: 'NSE' }]),
      subscribe: (_symbols: readonly string[], listener: (quotes: readonly unknown[]) => void) => {
        listeners.push(listener);
        return () => undefined;
      },
    } as unknown as MockMarketDataAdapter;
    const publisher = createMemoryPublisher();
    const failing = { publish: () => Promise.reject(new Error('x')), close: publisher.close };
    await startTickPump({ market, publisher, log });
    listeners[0]?.([]);
    expect(publisher.messages).toEqual([]);
    const other = { ...failing, publish: () => Promise.reject('plain string') };
    await startTickPump({ market, publisher: other, log });
    listeners[1]?.([{}]);
    await flushPromises();
    expect(log.warn).toHaveBeenCalledWith('Tick publishing failed: plain string');
  });
});
