import {
  PaperEngine,
  createEngineContext,
  createMapInstrumentSource,
  createMapPriceSource,
} from '@nthstock/paperEngine';
import { fixedClock } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';

// Proves the MSW mocks can run the isomorphic paper engine in the browser build (T-064).
describe('@nthstock/paperEngine in apps/web/src/mocks', () => {
  it('runs with an injected clock and price source', () => {
    const ctx = createEngineContext({
      clock: fixedClock('2026-09-25T04:00:00Z'),
      prices: createMapPriceSource([[2885, 1_234_50]]),
    });
    expect(ctx.nowIso()).toBe('2026-09-25T04:00:00.000Z');
    expect(ctx.ltp(2885)).toBe(1_234_50);
  });

  it('places and executes a paper order (T-128)', () => {
    const engine = new PaperEngine({
      ctx: createEngineContext({
        clock: fixedClock('2026-09-25T04:30:00Z'),
        prices: createMapPriceSource([[2885, 1_234_50]]),
      }),
      instruments: createMapInstrumentSource([
        {
          token: 2885,
          symbol: 'RELIANCE',
          exchange: 'NSE',
          lowerCircuit: 1_000_00,
          upperCircuit: 1_500_00,
        },
      ]),
    });
    const result = engine.place({
      token: 2885,
      side: 'BUY',
      type: 'MARKET',
      product: 'DELIVERY',
      qty: 2,
    });
    expect(result).toMatchObject({
      ok: true,
      order: { status: 'EXECUTED', avgFillPrice: 1_234_50 },
    });
  });
});
