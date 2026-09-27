import { expect } from 'vitest';
import { PAPER_OPENING_BALANCE_PAISE, type LedgerEntry } from '../../portfolio.js';
import { defineScenarios, type ScenarioClient } from '../harness.js';
import { MONDAY_10_00_IST, buy, expectError, pinnedStock, start } from './orders.js';

/**
 * Funds scenarios (T-157): the summary, the paginated ledger and the reset, against both mock
 * backends (apps/api T-155 and MSW T-156). Like the order scenarios, each one sets the backend
 * clock to a fixed IST instant and scripts the LTP the paper engines see.
 */

/** Tuesday 29 Sep 2026, 10:00 IST: the day after the scenario day, market open. */
const TUESDAY_10_00_IST = '2026-09-29T04:30:00.000Z';

/** Every ledger entry, newest first, following the cursor `limit` at a time. */
async function wholeLedger(client: ScenarioClient, limit: number): Promise<LedgerEntry[]> {
  const entries: LedgerEntry[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < 50; page += 1) {
    const result = await client.call('fundsLedger', {
      query: { limit, ...(cursor ? { cursor } : {}) },
    });
    expect(result.items.length).toBeLessThanOrEqual(limit);
    entries.push(...result.items);
    cursor = result.nextCursor;
    if (cursor === null) return entries;
  }
  throw new Error('the ledger never ended');
}

export const fundsScenarios = defineScenarios('funds', [
  {
    name: 'auth: the ledger and the reset need a session, and a reset needs the CSRF token',
    async run(client) {
      await expectError(client.callError('fundsLedger'), 401, 'UNAUTHORIZED');
      await expectError(
        client.callError('fundsReset', { body: { confirm: 'RESET' } }),
        401,
        'UNAUTHORIZED',
      );
      await start(client, '8420000001');
      await expectError(
        client.callError('fundsReset', { body: { confirm: 'RESET' }, csrf: 'not-the-token' }),
        403,
        'FORBIDDEN',
      );
      await expectError(
        client.callError('fundsReset', { body: { confirm: 'reset' } }),
        400,
        'VALIDATION_ERROR',
      );
      await expectError(client.callError('fundsReset', { body: {} }), 400, 'VALIDATION_ERROR');
    },
  },
  {
    name: 'summary: a fresh account has ₹10,00,000.00; a buy moves only available cash',
    async run(client) {
      const stock = await start(client, '8420000002');
      const opening = await client.call('fundsSummary');
      expect(opening).toMatchObject({
        openingBalance: PAPER_OPENING_BALANCE_PAISE,
        balance: PAPER_OPENING_BALANCE_PAISE,
        available: PAPER_OPENING_BALANCE_PAISE,
        blocked: 0,
        realisedPnlToday: 0,
      });
      await client.call('orderPlace', { body: buy(stock, { qty: 10 }) });
      const after = await client.call('fundsSummary');
      expect(opening.available - after.available).toBe(10 * stock.base);
      expect(after.openingBalance).toBe(PAPER_OPENING_BALANCE_PAISE);
    },
  },
  {
    name: 'ledger: newest first by cursor, signed amounts that add up to available cash',
    async run(client) {
      const stock = await start(client, '8420000003');
      await client.call('orderPlace', { body: buy(stock, { qty: 5 }) });
      const resting = await client.call('orderPlace', {
        body: buy(stock, { qty: 4, type: 'LIMIT', price: stock.below }),
      });
      await client.call('orderCancel', { params: { id: resting.id } });
      await client.call('orderPlace', { body: buy(stock, { side: 'SELL', qty: 2 }) });

      const entries = await wholeLedger(client, 3);
      expect(entries.map((e) => e.type)).toEqual([
        'TRADE_CREDIT',
        'ORDER_RELEASE',
        'ORDER_BLOCK',
        'TRADE_DEBIT',
        'ORDER_RELEASE',
        'ORDER_BLOCK',
        'OPENING_CREDIT',
      ]);
      expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
      const oldestFirst = [...entries].reverse();
      let running = 0;
      for (const entry of oldestFirst) {
        running += entry.amount;
        expect(entry.balanceAfter).toBe(running);
      }
      const funds = await client.call('fundsSummary');
      expect(running).toBe(funds.available);
      expect(entries[0]).toMatchObject({ amount: 2 * stock.base, orderId: expect.any(String) });
      const times = oldestFirst.map((e) => Date.parse(e.createdAt));
      expect(times).toEqual([...times].sort((a, b) => a - b));

      await expectError(
        client.callError('fundsLedger', { query: { cursor: 'not-an-entry' } }),
        400,
        'VALIDATION_ERROR',
      );
      await expectError(
        client.callError('fundsLedger', { query: { limit: 0 } }),
        400,
        'VALIDATION_ERROR',
      );
    },
  },
  {
    name: 'reset: open orders cancelled, positions and holdings cleared, ₹10,00,000.00 restored',
    async run(client) {
      const stock = await start(client, '8420000004');
      await client.call('orderPlace', { body: buy(stock, { qty: 6 }) });
      // The next morning the delivery buy is a holding; then a position and a resting order.
      await client.setTime(TUESDAY_10_00_IST);
      await client.call('sessionRefresh');
      await client.setPrice(stock.token, stock.above);
      const tcs = await pinnedStock(client, 'TCS');
      await client.call('orderPlace', { body: buy(tcs, { qty: 2, product: 'INTRADAY' }) });
      const resting = await client.call('orderPlace', {
        body: buy(stock, { qty: 3, type: 'LIMIT', price: stock.below }),
      });
      expect((await client.call('holdingsList')).items).toHaveLength(1);
      expect((await client.call('positionsList')).items).toHaveLength(1);
      expect((await client.call('fundsSummary')).blocked).toBe(3 * stock.below);

      const funds = await client.call('fundsReset', { body: { confirm: 'RESET' } });
      expect(funds).toEqual({
        openingBalance: PAPER_OPENING_BALANCE_PAISE,
        balance: PAPER_OPENING_BALANCE_PAISE,
        blocked: 0,
        available: PAPER_OPENING_BALANCE_PAISE,
        realisedPnlToday: 0,
        asOf: expect.any(String),
      });
      expect(await client.call('fundsSummary')).toMatchObject({
        available: PAPER_OPENING_BALANCE_PAISE,
      });
      expect((await client.call('ordersList')).items).toEqual([]);
      expect((await client.call('positionsList')).items).toEqual([]);
      expect((await client.call('holdingsList')).items).toEqual([]);
      expect(await client.call('portfolioSummary')).toMatchObject({
        investedValue: 0,
        currentValue: 0,
        holdingsCount: 0,
        positionsCount: 0,
      });
      await expectError(
        client.callError('orderGet', { params: { id: resting.id } }),
        404,
        'NOT_FOUND',
      );

      // The ledger keeps its history and ends with the RESET entry.
      const [latest, released] = (await client.call('fundsLedger', { query: { limit: 2 } })).items;
      expect(latest).toMatchObject({
        type: 'RESET',
        amount: 6 * stock.base + 2 * tcs.base,
        balanceAfter: PAPER_OPENING_BALANCE_PAISE,
        orderId: null,
      });
      // (6 INFY bought yesterday, 2 TCS today; the resting order's block was released first.)
      expect(released).toMatchObject({ type: 'ORDER_RELEASE', orderId: resting.id });

      // The account trades again as new.
      const again = await client.call('orderPlace', { body: buy(stock, { qty: 1 }) });
      expect(again.status).toBe('EXECUTED');
      await client.setTime(MONDAY_10_00_IST);
    },
  },
]);
