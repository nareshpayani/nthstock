import { expect } from 'vitest';
import type { Holding, PortfolioSummary } from '../../portfolio.js';
import { TICK_SIZE_PAISE } from '../../primitives.js';
import { defineScenarios } from '../harness.js';
import {
  MONDAY_10_00_IST,
  MONDAY_20_00_IST,
  TUESDAY_09_16_IST,
  buy,
  expectError,
  pinnedStock,
  start,
} from './orders.js';

/**
 * Portfolio scenarios (T-143): positions, holdings, the portfolio summary and order history,
 * against both mock backends (apps/api T-141 and MSW T-142). Like the order scenarios, each one
 * sets the backend clock to a fixed IST instant and scripts the LTP the paper engines see, so the
 * numbers never depend on when CI runs or on the random walk.
 */

/** Tuesday 29 Sep 2026, 10:00 IST: the day after, market open. */
const TUESDAY_10_00_IST = '2026-09-29T04:30:00.000Z';

/** The sums a summary must equal: the holdings rows (T-152 reads the same totals). */
function totals(rows: readonly Holding[]): Partial<PortfolioSummary> {
  return {
    investedValue: rows.reduce((sum, row) => sum + row.investedValue, 0),
    currentValue: rows.reduce((sum, row) => sum + row.currentValue, 0),
    totalPnl: rows.reduce((sum, row) => sum + row.pnl, 0),
    dayPnl: rows.reduce((sum, row) => sum + row.dayChange, 0),
    holdingsCount: rows.length,
  };
}

export const portfolioScenarios = defineScenarios('portfolio', [
  {
    name: 'auth: positions, holdings, summary and order history need a session',
    async run(client) {
      await expectError(client.callError('positionsList'), 401, 'UNAUTHORIZED');
      await expectError(client.callError('holdingsList'), 401, 'UNAUTHORIZED');
      await expectError(client.callError('portfolioSummary'), 401, 'UNAUTHORIZED');
      await expectError(
        client.callError('orderHistory', { params: { id: 'pe_any' } }),
        401,
        'UNAUTHORIZED',
      );
    },
  },
  {
    name: 'positions: fills show as positions marked to the LTP, with realised P&L on a close',
    async run(client) {
      const stock = await start(client, '8410000001');
      expect((await client.call('positionsList')).items).toEqual([]);

      await client.call('orderPlace', { body: buy(stock, { qty: 10 }) });
      await client.call('orderPlace', {
        body: buy(stock, { side: 'SELL', qty: 3, product: 'INTRADAY' }),
      });
      let positions = (await client.call('positionsList')).items;
      expect(positions).toEqual([
        {
          token: stock.token,
          symbol: 'INFY',
          exchange: 'NSE',
          product: 'DELIVERY',
          netQty: 10,
          buyQty: 10,
          sellQty: 0,
          avgBuyPrice: stock.base,
          avgSellPrice: 0,
          ltp: stock.base,
          realisedPnl: 0,
          unrealisedPnl: 0,
        },
        expect.objectContaining({ product: 'INTRADAY', netQty: -3, avgSellPrice: stock.base }),
      ]);

      // A tick marks both to market: the long gains, the short loses.
      await client.setPrice(stock.token, stock.above);
      positions = (await client.call('positionsList')).items;
      const move = stock.above - stock.base;
      expect(positions.map((p) => [p.product, p.ltp, p.unrealisedPnl])).toEqual([
        ['DELIVERY', stock.above, 10 * move],
        ['INTRADAY', stock.above, -3 * move],
      ]);

      // Selling 4 of the delivery shares books realised P&L on them.
      await client.call('orderPlace', { body: buy(stock, { side: 'SELL', qty: 4 }) });
      const [delivery] = (await client.call('positionsList')).items;
      expect(delivery).toMatchObject({
        netQty: 6,
        realisedPnl: 4 * move,
        unrealisedPnl: 6 * move,
      });
      const summary = await client.call('portfolioSummary');
      expect(summary).toMatchObject({ positionsCount: 2, holdingsCount: 0, investedValue: 0 });
    },
  },
  {
    name: 'holdings: delivery buys become holdings after the close; the summary sums the rows',
    async run(client) {
      const stock = await start(client, '8410000002');
      await client.call('orderPlace', { body: buy(stock, { qty: 6 }) });
      const tcs = await pinnedStock(client, 'TCS');
      await client.call('orderPlace', { body: buy(tcs, { qty: 2 }) });
      expect((await client.call('holdingsList')).items).toEqual([]);

      // The next morning: yesterday's delivery buys are holdings, valued at today's LTP.
      await client.setTime(TUESDAY_10_00_IST);
      await client.call('sessionRefresh');
      await client.setPrice(stock.token, stock.above);
      await client.setPrice(tcs.token, tcs.below);
      expect((await client.call('positionsList')).items).toEqual([]);
      const holdings = (await client.call('holdingsList')).items;
      expect(holdings.map((h) => h.symbol)).toEqual(['INFY', 'TCS']);
      const [infy, tcsRow] = holdings;
      expect(infy).toMatchObject({
        token: stock.token,
        qty: 6,
        avgPrice: stock.base,
        ltp: stock.above,
        investedValue: 6 * stock.base,
        currentValue: 6 * stock.above,
        pnl: 6 * (stock.above - stock.base),
      });
      expect(tcsRow).toMatchObject({ qty: 2, ltp: tcs.below, pnl: 2 * (tcs.below - tcs.base) });
      for (const row of holdings) {
        // The day's change is against the previous close, a whole number of paise per share.
        expect(Number.isInteger(row.dayChange / row.qty)).toBe(true);
        const prevClose = row.ltp - row.dayChange / row.qty;
        expect(prevClose % TICK_SIZE_PAISE).toBe(0);
        expect(prevClose).toBeGreaterThan(0);
      }

      const summary = await client.call('portfolioSummary');
      expect(summary).toMatchObject({ ...totals(holdings), positionsCount: 0 });
      expect(Date.parse(summary.asOf)).toBeGreaterThanOrEqual(Date.parse(TUESDAY_10_00_IST));
    },
  },
  {
    name: 'order history: placed, modified and cancelled, each with its time; 404 for others',
    async run(client) {
      const stock = await start(client, '8410000003');
      const order = await client.call('orderPlace', {
        body: buy(stock, { qty: 5, type: 'LIMIT', price: stock.below }),
      });
      const lower = stock.below - 4 * TICK_SIZE_PAISE;
      await client.call('orderModify', {
        params: { id: order.id },
        body: { qty: 7, price: lower },
      });
      await client.call('orderCancel', { params: { id: order.id } });

      const history = await client.call('orderHistory', { params: { id: order.id } });
      expect(history.orderId).toBe(order.id);
      expect(history.items.map((e) => [e.event, e.status, e.qty, e.price, e.note])).toEqual([
        ['PLACED', 'OPEN', 5, stock.below, null],
        ['MODIFIED', 'OPEN', 7, lower, null],
        ['CANCELLED', 'CANCELLED', 7, lower, 'Cancelled by you.'],
      ]);
      const times = history.items.map((e) => Date.parse(e.at));
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(times[0]).toBe(Date.parse(order.placedAt));

      await client.call('logout');
      await start(client, '8410000004');
      await expectError(
        client.callError('orderHistory', { params: { id: order.id } }),
        404,
        'NOT_FOUND',
      );
    },
  },
  {
    name: 'order history: an AMO shows placed, released at 9:15 IST and executed',
    async run(client) {
      const stock = await start(client, '8410000005', 'INFY', MONDAY_20_00_IST);
      const amo = await client.call('orderPlace', {
        body: buy(stock, { qty: 2, type: 'LIMIT', price: stock.below }),
      });
      expect(amo.status).toBe('AMO');
      await client.setTime(TUESDAY_09_16_IST);
      await client.call('sessionRefresh');
      await client.setPrice(stock.token, stock.below);
      const history = await client.call('orderHistory', { params: { id: amo.id } });
      expect(history.items.map((e) => [e.event, e.status])).toEqual([
        ['PLACED', 'AMO'],
        ['RELEASED', 'OPEN'],
        ['EXECUTED', 'EXECUTED'],
      ]);
      expect(Date.parse(history.items[1]?.at ?? '')).toBe(Date.parse('2026-09-29T03:45:00.000Z'));
      expect(history.items[2]?.fillPrice).toBe(stock.below);
      // Back to the usual scenario day for anything that follows.
      await client.setTime(MONDAY_10_00_IST);
    },
  },
]);
