import { describe, expect, it } from 'vitest';
import { TICK_BATCH_VERSION, TICKS_CHANNEL, TickBatch } from './pubsub.js';

const quote = {
  token: 1,
  symbol: 'INFY',
  exchange: 'NSE',
  ltp: 150_000,
  change: 500,
  changeBp: 33,
  open: 149_500,
  high: 150_500,
  low: 149_000,
  prevClose: 149_500,
  volume: 1_000,
  ts: '2026-09-25T04:00:00.000Z',
};

describe('TickBatch', () => {
  it('names a versioned channel', () => {
    expect(TICKS_CHANNEL).toMatch(/:v1$/);
  });

  it('accepts a batch of quotes and rejects an empty or unversioned one', () => {
    expect(TickBatch.parse({ v: TICK_BATCH_VERSION, quotes: [quote] }).quotes).toHaveLength(1);
    expect(TickBatch.safeParse({ v: TICK_BATCH_VERSION, quotes: [] }).success).toBe(false);
    expect(TickBatch.safeParse({ quotes: [quote] }).success).toBe(false);
  });
});
