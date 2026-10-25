import type { TickStreamEntry } from '@nthstock/contracts';
import { generateSymbolMaster, MockMarketDataAdapter } from '@nthstock/marketData';
import { fixedClock, shardOf } from '@nthstock/utils';
import { afterEach, describe, expect, it } from 'vitest';
import { startQuoteWriter } from './quoteWriter.js';
import type { TickSink } from './tickStream.js';

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
  const entries: TickStreamEntry[] = [];
  let failure: Error | null = null;
  const sink: TickSink = {
    append(entry) {
      if (failure) return Promise.reject(failure);
      entries.push(entry);
      return Promise.resolve();
    },
  };
  return { sink, entries, fail: (error: Error | null) => (failure = error) };
}

afterEach(() => {
  market?.dispose();
});

describe('startQuoteWriter', () => {
  it("writes only its shard's instruments, numbered, while it holds the lease", async () => {
    const market = newMarket();
    const { sink, entries } = recorder();
    let held = false;
    const writer = await startQuoteWriter({
      market,
      shard: 1,
      shards: 4,
      holdsLease: () => held,
      sink,
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
    expect(entries).toEqual([]);
    expect(writer.seq).toBe(0);

    held = true;
    market.tick();
    await Promise.resolve();
    expect(entries.length).toBeGreaterThan(0);
    // Numbered 1, 2, … in the order written, all for shard 1.
    expect(entries.map((entry) => entry.seq)).toEqual(entries.map((_, index) => index + 1));
    expect(writer.seq).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.shard).toBe(1);
      for (const quote of entry.quotes) expect(writer.tokens.has(quote.token)).toBe(true);
    }

    writer.stop();
    writer.stop();
    const count = entries.length;
    market.tick();
    await Promise.resolve();
    expect(entries).toHaveLength(count);
  });

  it('logs a failing write once, and its recovery', async () => {
    const market = newMarket();
    const { sink, fail } = recorder();
    const warnings: string[] = [];
    const infos: string[] = [];
    const writer = await startQuoteWriter({
      market,
      shard: 0,
      shards: 1,
      holdsLease: () => true,
      sink,
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
