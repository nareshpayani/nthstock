import { expect } from 'vitest';
import { CandleRange } from '../../market.js';
import { defineScenarios, type ScenarioClient } from '../harness.js';

/**
 * Market scenarios (T-063): every market route, happy path and errors, run against both mock
 * backends. Prices move between calls on a live backend, so these check shapes, ordering and
 * invariants, never exact prices.
 */

const expectError = async (
  pending: ReturnType<ScenarioClient['callError']>,
  status: number,
  code: string,
  message?: string,
) => {
  const { status: actual, body } = await pending;
  expect(actual).toBe(status);
  expect(body.error.code).toBe(code);
  if (message !== undefined) expect(body.error.message).toBe(message);
};

const isAscending = (times: readonly string[]) =>
  times.every((t, i) => i === 0 || Date.parse(times[i - 1] ?? t) < Date.parse(t));

export const marketScenarios = defineScenarios('market', [
  // ---- Indices ----------------------------------------------------------------------------
  {
    name: 'indices: lists the headline indices with sparklines',
    async run(client) {
      const { items } = await client.call('marketIndices');

      expect(items.map((i) => i.symbol)).toEqual(expect.arrayContaining(['NIFTY50', 'SENSEX']));
      for (const index of items) expect(index.sparkline.length).toBeGreaterThan(0);
    },
  },

  // ---- Curated lists ----------------------------------------------------------------------
  {
    name: 'lists: every curated list is also served by id',
    async run(client) {
      const { items } = await client.call('marketLists');
      expect(items.map((l) => l.id)).toEqual(expect.arrayContaining(['market-giants', 'top-it']));

      for (const list of items) {
        const one = await client.call('marketList', { params: { id: list.id } });
        expect(one.id).toBe(list.id);
        expect(one.title).toBe(list.title);
        expect(one.items.length).toBe(list.items.length);
      }
    },
  },
  {
    name: 'lists: an unknown list is 404 and a malformed id is 400',
    async run(client) {
      await expectError(
        client.callError('marketList', { params: { id: 'no-such-list' } }),
        404,
        'NOT_FOUND',
        'List no-such-list not found',
      );
      await expectError(
        client.callError('marketList', { params: { id: 'Not_A_Slug' } }),
        400,
        'VALIDATION_ERROR',
      );
    },
  },

  // ---- Movers -----------------------------------------------------------------------------
  {
    name: 'movers: gainers rise, losers fall, within the limit',
    async run(client) {
      const gainers = await client.call('marketMovers', {
        query: { index: 'NIFTY50', direction: 'gainers', limit: 5 },
      });
      const losers = await client.call('marketMovers', {
        query: { index: 'NIFTY50', direction: 'losers', limit: 5 },
      });

      expect(gainers).toMatchObject({ index: 'NIFTY50', direction: 'gainers' });
      expect(losers).toMatchObject({ index: 'NIFTY50', direction: 'losers' });
      expect(gainers.items.length).toBeLessThanOrEqual(5);
      expect(losers.items.length).toBeLessThanOrEqual(5);
      expect(gainers.items.every((row) => row.change > 0)).toBe(true);
      expect(losers.items.every((row) => row.change < 0)).toBe(true);
    },
  },
  {
    name: 'movers: an unknown index is 404 and a bad direction is 400',
    async run(client) {
      await expectError(
        client.callError('marketMovers', { query: { index: 'NOPE', direction: 'gainers' } }),
        404,
        'NOT_FOUND',
        'Index NOPE not found',
      );
      await expectError(
        client.callError('marketMovers', { query: { index: 'NIFTY50', direction: 'sideways' } }),
        400,
        'VALIDATION_ERROR',
      );
    },
  },

  // ---- Batch quotes -----------------------------------------------------------------------
  {
    name: 'quotes: keeps request order and skips unknown symbols',
    async run(client) {
      const { items } = await client.call('marketQuotes', {
        query: { symbols: 'TCS,NOPE,INFY,NIFTY50' },
      });

      expect(items.map((q) => q.symbol)).toEqual(['TCS', 'INFY', 'NIFTY50']);
      for (const quote of items) {
        expect(quote.low).toBeLessThanOrEqual(quote.high);
        expect(quote.change).toBe(quote.ltp - quote.prevClose);
      }
    },
  },
  {
    name: 'quotes: missing or malformed symbols are 400',
    async run(client) {
      await expectError(client.callError('marketQuotes'), 400, 'VALIDATION_ERROR');
      await expectError(
        client.callError('marketQuotes', { query: { symbols: 'infy' } }),
        400,
        'VALIDATION_ERROR',
      );
    },
  },

  // ---- Search -----------------------------------------------------------------------------
  {
    name: 'search: an exact symbol ranks first and the limit holds',
    async run(client) {
      const { items } = await client.call('marketSearch', { query: { q: 'infy', limit: 3 } });

      expect(items[0]?.symbol).toBe('INFY');
      expect(items.length).toBeLessThanOrEqual(3);
    },
  },
  {
    name: 'search: an empty or blank query is 400',
    async run(client) {
      for (const q of ['', '   ']) {
        await expectError(
          client.callError('marketSearch', { query: { q } }),
          400,
          'VALIDATION_ERROR',
        );
      }
      await expectError(client.callError('marketSearch'), 400, 'VALIDATION_ERROR');
    },
  },

  // ---- Instrument -------------------------------------------------------------------------
  {
    name: 'instrument: returns equities and indices by symbol',
    async run(client) {
      const infy = await client.call('instrument', { params: { symbol: 'INFY' } });
      expect(infy).toMatchObject({ symbol: 'INFY', exchange: 'NSE', type: 'EQUITY' });

      const nifty = await client.call('instrument', { params: { symbol: 'NIFTY50' } });
      expect(nifty).toMatchObject({ symbol: 'NIFTY50', type: 'INDEX', isin: null });
    },
  },
  {
    name: 'instrument: unknown symbol or exchange is 404, malformed input is 400',
    async run(client) {
      await expectError(
        client.callError('instrument', { params: { symbol: 'NOPE' } }),
        404,
        'NOT_FOUND',
        'Symbol NOPE not found',
      );
      await expectError(
        client.callError('instrument', { params: { symbol: 'INFY' }, query: { exchange: 'BSE' } }),
        404,
        'NOT_FOUND',
      );
      await expectError(
        client.callError('instrument', { params: { symbol: 'infy' } }),
        400,
        'VALIDATION_ERROR',
      );
      await expectError(
        client.callError('instrument', { params: { symbol: 'INFY' }, query: { exchange: 'LSE' } }),
        400,
        'VALIDATION_ERROR',
      );
    },
  },

  // ---- Candles ----------------------------------------------------------------------------
  {
    name: 'candles: every range returns ordered bars for an equity and an index',
    async run(client) {
      for (const symbol of ['INFY', 'NIFTY50']) {
        for (const range of CandleRange.options) {
          const series = await client.call('instrumentCandles', {
            params: { symbol },
            query: { range },
          });
          expect(series).toMatchObject({ symbol, range });
          expect(series.candles.length).toBeGreaterThan(0);
          expect(isAscending(series.candles.map((c) => c.t))).toBe(true);
        }
      }
    },
  },
  {
    name: 'candles: a missing or invalid range is 400, an unknown symbol 404',
    async run(client) {
      await expectError(
        client.callError('instrumentCandles', { params: { symbol: 'INFY' } }),
        400,
        'VALIDATION_ERROR',
      );
      await expectError(
        client.callError('instrumentCandles', {
          params: { symbol: 'INFY' },
          query: { range: '2D' },
        }),
        400,
        'VALIDATION_ERROR',
      );
      await expectError(
        client.callError('instrumentCandles', {
          params: { symbol: 'NOPE' },
          query: { range: '1D' },
        }),
        404,
        'NOT_FOUND',
        'Symbol NOPE not found',
      );
    },
  },

  // ---- Depth ------------------------------------------------------------------------------
  {
    name: 'depth: five levels a side with the best bid below the best ask',
    async run(client) {
      const depth = await client.call('instrumentDepth', { params: { symbol: 'INFY' } });

      expect(depth.symbol).toBe('INFY');
      const bestBid = depth.bids[0]?.price ?? 0;
      const bestAsk = depth.asks[0]?.price ?? 0;
      expect(bestBid).toBeLessThan(bestAsk);
      expect(depth.totalBidQty).toBeGreaterThanOrEqual(
        depth.bids.reduce((sum, level) => sum + level.qty, 0),
      );
    },
  },
  {
    name: 'depth: an index or unknown symbol is 404',
    async run(client) {
      await expectError(
        client.callError('instrumentDepth', { params: { symbol: 'NIFTY50' } }),
        404,
        'NOT_FOUND',
        'Depth for NIFTY50 not found',
      );
      await expectError(
        client.callError('instrumentDepth', { params: { symbol: 'NOPE' } }),
        404,
        'NOT_FOUND',
      );
    },
  },

  // ---- Stats ------------------------------------------------------------------------------
  {
    name: 'stats: consistent ranges and circuit band for an equity',
    async run(client) {
      const stats = await client.call('instrumentStats', { params: { symbol: 'TCS' } });

      expect(stats.symbol).toBe('TCS');
      expect(stats.low).toBeLessThanOrEqual(stats.high);
      expect(stats.week52Low).toBeLessThanOrEqual(stats.low);
      expect(stats.week52High).toBeGreaterThanOrEqual(stats.high);
      expect(stats.lowerCircuit).toBeLessThan(stats.upperCircuit);
    },
  },
  {
    name: 'stats: an index or unknown symbol is 404',
    async run(client) {
      await expectError(
        client.callError('instrumentStats', { params: { symbol: 'SENSEX' } }),
        404,
        'NOT_FOUND',
        'Stats for SENSEX not found',
      );
      await expectError(
        client.callError('instrumentStats', { params: { symbol: 'NOPE' } }),
        404,
        'NOT_FOUND',
      );
    },
  },
]);
