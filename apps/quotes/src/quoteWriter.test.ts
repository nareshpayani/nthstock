import { TickBatch } from '@nthstock/contracts';
import { generateSymbolMaster, MockMarketDataAdapter } from '@nthstock/marketData';
import { fixedClock, shardOf } from '@nthstock/utils';
import { afterEach, describe, expect, it } from 'vitest';
import { startQuoteWriter, type TickPublisher } from './quoteWriter.js';

const silent = { info: () => undefined, warn: () => undefined };
const master = generateSymbolMaster({ equityCount: 80 });
let market: MockMarketDataAdapter | undefined;

function newMarket() {
  market = new MockMarketDataAdapter({
    master,
    clock: fixedClock('2026-09-28T05:00:00.000Z'), // Monday 10:30 IST
    alwaysOpen: true,
    scheduler: { setInterval: () => 0, clearInterval: () => undefined },
  });
  return market;
}

function recorder() {
  const messages: { channel: string; batch: TickBatch }[] = [];
  let failure: Error | null = null;
  const publisher: TickPublisher = {
    publish(channel, message) {
      if (failure) return Promise.reject(failure);
      messages.push({ channel, batch: TickBatch.parse(JSON.parse(message)) });
      return Promise.resolve(1);
    },
  };
  return { publisher, messages, fail: (error: Error | null) => (failure = error) };
}

afterEach(() => {
  market?.dispose();
});

describe('startQuoteWriter', () => {
  it("publishes only its shard's instruments, while it holds the lease", async () => {
    const market = newMarket();
    const { publisher, messages } = recorder();
    let held = false;
    const writer = await startQuoteWriter({
      market,
      shard: 1,
      shards: 4,
      holdsLease: () => held,
      publisher,
      channel: 'test:ticks',
      log: silent,
    });

    const all = await market.listInstruments();
    expect([...writer.tokens].sort()).toEqual(
      all
        .filter((i) => shardOf(i.token, 4) === 1)
        .map((i) => i.token)
        .sort(),
    );
    expect(writer.tokens.size).toBeGreaterThan(0);
    expect(writer.tokens.size).toBeLessThan(all.length);

    market.tick();
    expect(messages).toEqual([]);

    held = true;
    market.tick();
    await Promise.resolve();
    expect(messages.length).toBeGreaterThan(0);
    for (const { channel, batch } of messages) {
      expect(channel).toBe('test:ticks');
      for (const quote of batch.quotes) expect(writer.tokens.has(quote.token)).toBe(true);
    }

    writer.stop();
    writer.stop();
    const count = messages.length;
    market.tick();
    await Promise.resolve();
    expect(messages).toHaveLength(count);
  });

  it('logs a failing publish once, and its recovery', async () => {
    const market = newMarket();
    const { publisher, fail } = recorder();
    const warnings: string[] = [];
    const infos: string[] = [];
    const writer = await startQuoteWriter({
      market,
      shard: 0,
      shards: 1,
      holdsLease: () => true,
      publisher,
      log: { info: (m) => infos.push(m), warn: (m) => warnings.push(m) },
    });

    fail(new Error('redis down'));
    market.tick();
    market.tick();
    await new Promise((resolve) => setImmediate(resolve));
    expect(warnings).toEqual(['tick publishing failed']);

    fail(null);
    market.tick();
    await new Promise((resolve) => setImmediate(resolve));
    expect(infos).toEqual(['tick publishing recovered']);
    writer.stop();
  });
});
