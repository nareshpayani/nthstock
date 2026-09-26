import { createEngineContext, createMapPriceSource } from '@nthstock/paperEngine';
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
});
