import { expect } from 'vitest';
import { DEV_OTP } from '../../auth.js';
import type { Order, PlaceOrderRequest } from '../../orders.js';
import { PAPER_OPENING_BALANCE_PAISE } from '../../portfolio.js';
import { TICK_SIZE_PAISE } from '../../primitives.js';
import { defineScenarios, type ScenarioClient } from '../harness.js';

/**
 * Order scenarios (T-134): market, limit crossing, modify, cancel, insufficient funds and AMO,
 * against both mock backends (apps/api T-131 and MSW T-132).
 *
 * Time and prices are the scenario's, never the wall clock's or the random walk's:
 * - `setTime` puts the backend clock (auth and orders) on a fixed IST instant, so market hours
 *   and AMO behave the same whenever CI runs. Each scenario sets it first, then logs in.
 * - `setPrice` is a scripted tick: the paper engines see that LTP from then on, and orders it
 *   crosses fill at once, as on a real tick. Prices are derived from the instrument's previous
 *   close, so they sit well inside its ±20% circuit band.
 */

/** Monday 28 Sep 2026, 10:00 IST: a trading day, market open. */
const MONDAY_10_00_IST = '2026-09-28T04:30:00.000Z';
/** The same Monday, 20:00 IST: closed, so orders wait as AMO. */
const MONDAY_20_00_IST = '2026-09-28T14:30:00.000Z';
/** Tuesday 29 Sep 2026, 9:16 IST: one minute after the 9:15 AMO release. */
const TUESDAY_09_16_IST = '2026-09-29T03:46:00.000Z';

const tick = (paise: number, round: (n: number) => number = Math.round) =>
  round(paise / TICK_SIZE_PAISE) * TICK_SIZE_PAISE;

const expectError = async (
  pending: ReturnType<ScenarioClient['callError']>,
  status: number,
  code: string,
) => {
  const { status: actual, body } = await pending;
  expect(actual).toBe(status);
  expect(body.error.code).toBe(code);
  return body.error;
};

type Stock = {
  token: number;
  /** A base LTP (the previous close, on the tick). */
  base: number;
  /** About 2% below and above `base`, on the tick. */
  below: number;
  above: number;
};

/** Sets the clock, logs in as `mobile`, and pins `symbol` at its previous close. */
async function start(
  client: ScenarioClient,
  mobile: string,
  symbol = 'INFY',
  at = MONDAY_10_00_IST,
): Promise<Stock> {
  await client.setTime(at);
  const { requestId } = await client.call('otpRequest', { body: { mobile } });
  await client.call('otpVerify', { body: { requestId, mobile, otp: DEV_OTP } });
  const { token } = await client.call('instrument', { params: { symbol } });
  const stats = await client.call('instrumentStats', { params: { symbol } });
  const base = tick(stats.prevClose);
  const stock = {
    token,
    base,
    below: tick(base * 0.98, Math.floor),
    above: tick(base * 1.02, Math.ceil),
  };
  expect(stock.below).toBeGreaterThan(stats.lowerCircuit);
  expect(stock.above).toBeLessThan(stats.upperCircuit);
  await client.setPrice(token, base);
  return stock;
}

const buy = (
  stock: Stock,
  extra: Partial<PlaceOrderRequest> & Pick<PlaceOrderRequest, 'qty'>,
): PlaceOrderRequest => ({
  token: stock.token,
  side: 'BUY',
  type: 'MARKET',
  product: 'DELIVERY',
  ...extra,
});

async function ids(client: ScenarioClient, status?: Order['status']) {
  const page = await client.call('ordersList', { query: status ? { status } : {} });
  return page.items.map((order) => order.id);
}

export const orderScenarios = defineScenarios('orders', [
  {
    name: 'auth: order and funds routes need a session, and a place needs the CSRF token',
    async run(client) {
      await expectError(client.callError('ordersList'), 401, 'UNAUTHORIZED');
      await expectError(client.callError('fundsSummary'), 401, 'UNAUTHORIZED');
      const stock = await start(client, '8400000001');
      await expectError(
        client.callError('orderPlace', { body: buy(stock, { qty: 1 }), csrf: 'not-the-token' }),
        403,
        'FORBIDDEN',
      );
      expect(await ids(client)).toEqual([]);
    },
  },
  {
    name: 'market: a MARKET BUY executes at the LTP and debits the cash',
    async run(client) {
      const stock = await start(client, '8400000002');
      const funds = await client.call('fundsSummary');
      expect(funds).toMatchObject({
        openingBalance: PAPER_OPENING_BALANCE_PAISE,
        available: PAPER_OPENING_BALANCE_PAISE,
        blocked: 0,
      });

      const order = await client.call('orderPlace', { body: buy(stock, { qty: 10 }) });
      expect(order).toMatchObject({
        status: 'EXECUTED',
        type: 'MARKET',
        price: null,
        qty: 10,
        filledQty: 10,
        avgFillPrice: stock.base,
        statusReason: null,
      });
      expect(await client.call('orderGet', { params: { id: order.id } })).toEqual(order);
      expect(await ids(client, 'EXECUTED')).toEqual([order.id]);
      expect(await client.call('fundsSummary')).toMatchObject({
        available: PAPER_OPENING_BALANCE_PAISE - 10 * stock.base,
        blocked: 0,
      });
    },
  },
  {
    name: 'limit crossing: a LIMIT order rests OPEN and fills at its limit when the price crosses',
    async run(client) {
      const stock = await start(client, '8400000003');
      const order = await client.call('orderPlace', {
        body: buy(stock, { qty: 4, type: 'LIMIT', price: stock.below }),
      });
      expect(order).toMatchObject({ status: 'OPEN', filledQty: 0, avgFillPrice: null });
      expect((await client.call('fundsSummary')).blocked).toBe(4 * stock.below);

      await client.setPrice(stock.token, stock.below + TICK_SIZE_PAISE);
      expect((await client.call('orderGet', { params: { id: order.id } })).status).toBe('OPEN');

      await client.setPrice(stock.token, stock.below - TICK_SIZE_PAISE);
      const filled = await client.call('orderGet', { params: { id: order.id } });
      expect(filled).toMatchObject({ status: 'EXECUTED', filledQty: 4, avgFillPrice: stock.below });
      expect(await client.call('fundsSummary')).toMatchObject({
        blocked: 0,
        available: PAPER_OPENING_BALANCE_PAISE - 4 * stock.below,
      });

      // And a LIMIT SELL of those shares fills when the price rises to it.
      const sell = await client.call('orderPlace', {
        body: buy(stock, { side: 'SELL', qty: 4, type: 'LIMIT', price: stock.above }),
      });
      expect(sell.status).toBe('OPEN');
      await client.setPrice(stock.token, stock.above);
      expect(await client.call('orderGet', { params: { id: sell.id } })).toMatchObject({
        status: 'EXECUTED',
        avgFillPrice: stock.above,
      });
      expect((await client.call('fundsSummary')).available).toBe(
        PAPER_OPENING_BALANCE_PAISE + 4 * (stock.above - stock.below),
      );
    },
  },
  {
    name: 'modify: qty and price change on an OPEN order, re-blocking cash; a filled one is 409',
    async run(client) {
      const stock = await start(client, '8400000004');
      const order = await client.call('orderPlace', {
        body: buy(stock, { qty: 5, type: 'LIMIT', price: stock.below }),
      });
      const lower = stock.below - 10 * TICK_SIZE_PAISE;
      const modified = await client.call('orderModify', {
        params: { id: order.id },
        body: { qty: 8, price: lower },
      });
      expect(modified).toMatchObject({ id: order.id, status: 'OPEN', qty: 8, price: lower });
      expect((await client.call('fundsSummary')).blocked).toBe(8 * lower);

      // Moving the limit above the LTP makes it marketable: it fills at once.
      const crossed = await client.call('orderModify', {
        params: { id: order.id },
        body: { price: stock.base },
      });
      expect(crossed).toMatchObject({ status: 'EXECUTED', filledQty: 8, avgFillPrice: stock.base });
      expect((await client.call('fundsSummary')).blocked).toBe(0);

      const error = await expectError(
        client.callError('orderModify', { params: { id: order.id }, body: { qty: 1 } }),
        409,
        'INVALID_ORDER_STATE',
      );
      expect(error.details).toMatchObject({ reason: 'ILLEGAL_TRANSITION' });
      await expectError(
        client.callError('orderModify', { params: { id: order.id }, body: {} }),
        400,
        'VALIDATION_ERROR',
      );
    },
  },
  {
    name: "cancel: an OPEN order is CANCELLED and its cash released; another user's is 404",
    async run(client) {
      const stock = await start(client, '8400000005');
      const order = await client.call('orderPlace', {
        body: buy(stock, { qty: 3, type: 'LIMIT', price: stock.below }),
      });
      const cancelled = await client.call('orderCancel', { params: { id: order.id } });
      expect(cancelled).toMatchObject({
        status: 'CANCELLED',
        statusReason: 'Cancelled by you.',
        filledQty: 0,
      });
      expect(await client.call('fundsSummary')).toMatchObject({
        blocked: 0,
        available: PAPER_OPENING_BALANCE_PAISE,
      });
      expect(await ids(client, 'CANCELLED')).toEqual([order.id]);
      expect(await ids(client, 'OPEN')).toEqual([]);
      await expectError(
        client.callError('orderCancel', { params: { id: order.id } }),
        409,
        'INVALID_ORDER_STATE',
      );

      const open = await client.call('orderPlace', {
        body: buy(stock, { qty: 1, type: 'LIMIT', price: stock.below }),
      });
      await client.call('logout');
      await start(client, '8400000006');
      await expectError(
        client.callError('orderCancel', { params: { id: open.id } }),
        404,
        'NOT_FOUND',
      );
      await expectError(
        client.callError('orderGet', { params: { id: open.id } }),
        404,
        'NOT_FOUND',
      );
      expect(await ids(client)).toEqual([]);
    },
  },
  {
    name: 'insufficient funds: the order is REJECTED with the reason (422) and no cash moves',
    async run(client) {
      const stock = await start(client, '8400000007');
      const qty = Math.floor(PAPER_OPENING_BALANCE_PAISE / stock.base) + 1;
      const error = await expectError(
        client.callError('orderPlace', { body: buy(stock, { qty }) }),
        422,
        'INSUFFICIENT_FUNDS',
      );
      expect(error.message).toMatch(/^Not enough cash/);
      expect(error.details).toMatchObject({
        reason: 'INSUFFICIENT_FUNDS',
        order: { status: 'REJECTED', qty, statusReason: error.message },
      });
      const [rejected] = await ids(client, 'REJECTED');
      expect(rejected).toBeDefined();
      expect(await client.call('fundsSummary')).toMatchObject({
        available: PAPER_OPENING_BALANCE_PAISE,
        blocked: 0,
      });

      // A modify the cash cannot cover is refused and leaves the order as it was.
      const open = await client.call('orderPlace', {
        body: buy(stock, { qty: 1, type: 'LIMIT', price: stock.below }),
      });
      await expectError(
        client.callError('orderModify', {
          params: { id: open.id },
          body: { qty: Math.floor(PAPER_OPENING_BALANCE_PAISE / stock.below) + 1 },
        }),
        422,
        'INSUFFICIENT_FUNDS',
      );
      expect(await client.call('orderGet', { params: { id: open.id } })).toEqual(open);
    },
  },
  {
    name: 'AMO: an evening order waits as AMO and is released at 9:15 IST on the next trading day',
    async run(client) {
      const stock = await start(client, '8400000008', 'TCS', MONDAY_20_00_IST);
      await expectError(
        client.callError('orderPlace', { body: buy(stock, { qty: 1, product: 'INTRADAY' }) }),
        422,
        'MARKET_CLOSED',
      );
      const amo = await client.call('orderPlace', {
        body: buy(stock, { qty: 2, type: 'LIMIT', price: stock.below }),
      });
      expect(amo.status).toBe('AMO');
      expect((await client.call('fundsSummary')).blocked).toBe(2 * stock.below);
      const modified = await client.call('orderModify', {
        params: { id: amo.id },
        body: { qty: 3 },
      });
      expect(modified).toMatchObject({ status: 'AMO', qty: 3 });
      const other = await client.call('orderPlace', {
        body: buy(stock, { qty: 1, type: 'LIMIT', price: stock.below }),
      });
      expect(await client.call('orderCancel', { params: { id: other.id } })).toMatchObject({
        status: 'CANCELLED',
      });
      expect(await ids(client, 'AMO')).toEqual([amo.id]);

      // Overnight: the session outlives the 15-minute access token, so the app refreshes it.
      await client.setTime(TUESDAY_09_16_IST);
      await client.call('sessionRefresh');
      const released = await client.call('orderGet', { params: { id: amo.id } });
      expect(released).toMatchObject({ status: 'OPEN', qty: 3 });
      expect(Date.parse(released.updatedAt)).toBe(Date.parse('2026-09-29T03:45:00.000Z'));

      await client.setPrice(stock.token, stock.below);
      expect(await client.call('orderGet', { params: { id: amo.id } })).toMatchObject({
        status: 'EXECUTED',
        filledQty: 3,
        avgFillPrice: stock.below,
      });
      expect(await client.call('fundsSummary')).toMatchObject({
        blocked: 0,
        available: PAPER_OPENING_BALANCE_PAISE - 3 * stock.below,
      });
    },
  },
]);
