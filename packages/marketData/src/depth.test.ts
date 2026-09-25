import { Depth } from '@nthstock/contracts';
import { describe, expect, it } from 'vitest';
import { generateDepth } from './depth.js';
import { mulberry32 } from './prng.js';

describe('generateDepth', () => {
  it.each([500, 12_345, 152_000, 4_400_000, 5])(
    'gives descending bids, ascending asks, best bid < best ask, all on tick (LTP %i)',
    (ltp) => {
      const rng = mulberry32(ltp);
      for (let run = 0; run < 50; run += 1) {
        const book = generateDepth(ltp, rng, 300);
        Depth.parse({
          token: 1,
          symbol: 'INFY',
          exchange: 'NSE',
          ...book,
          ts: '2026-09-25T05:00:00.000Z',
        });
        const bids = book.bids.map((l) => l.price);
        const asks = book.asks.map((l) => l.price);
        expect(bids).toHaveLength(5);
        expect(asks).toHaveLength(5);
        for (let i = 1; i < 5; i += 1) {
          expect(bids[i]).toBeLessThan(bids[i - 1] as number);
          expect(asks[i]).toBeGreaterThan(asks[i - 1] as number);
        }
        expect(bids[0]).toBeLessThan(asks[0] as number);
        for (const price of [...bids, ...asks]) {
          expect(price % 5).toBe(0);
          expect(price).toBeGreaterThan(0);
        }
        for (const level of [...book.bids, ...book.asks]) {
          expect(level.orders).toBeLessThanOrEqual(level.qty);
          expect(level.orders).toBeGreaterThanOrEqual(1);
        }
        expect(book.totalBidQty).toBeGreaterThanOrEqual(book.bids.reduce((s, l) => s + l.qty, 0));
      }
    },
  );

  it('keeps the best bid within a tick of the LTP for normal prices', () => {
    const book = generateDepth(152_000, mulberry32(2));
    expect(152_000 - (book.bids[0]?.price ?? 0)).toBeLessThanOrEqual(5);
    expect(book.asks[0]?.price).toBeGreaterThanOrEqual(152_000);
  });
});
