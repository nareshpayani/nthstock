// @vitest-environment node
import {
  createQuoteStore,
  createTradingStore,
  createWsClient,
  tradingSourceOf,
} from '@nthstock/apiClient';
import { DEV_OTP, type Quote } from '@nthstock/contracts';
import {
  createScenarioClient,
  fetchBackend,
  type ScenarioClient,
} from '@nthstock/contracts/testing';
import { fixedClock, fromIst } from '@nthstock/utils';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_API_ORIGIN, TEST_WS_URL, createMockServer } from '../node';

/**
 * The trading store (T10) against the MSW transport (T08), end to end in Node: the real WS client,
 * quote store and trading store, so a fill reaches the order list, the position, the funds and the
 * price in one commit.
 */

const OPEN_MS = fromIst(2026, 9, 28, 10 * 60).getTime();
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

async function login(client: ScenarioClient, mobile: string) {
  const { requestId } = await client.call('otpRequest', { body: { mobile } });
  await client.call('otpVerify', { body: { requestId, mobile, otp: DEV_OTP } });
}

async function infy(client: ScenarioClient): Promise<Quote> {
  const { items } = await client.call('marketQuotes', { query: { symbols: 'INFY' } });
  const [quote] = items;
  if (!quote) throw new Error('INFY has no quote');
  return quote;
}

describe('trading store on the mock transport (T10, ADR 0012)', () => {
  it('commits a fill to orders, positions, funds and the price in the same commit', async () => {
    const mock = createMockServer({
      clock: fixedClock(OPEN_MS),
      tickIntervalMs: 1_000_000_000,
      flushMs: 20,
      auth: { now: () => OPEN_MS },
    });
    mock.server.listen({ onUnhandledRequest: 'error' });
    const client = createScenarioClient(fetchBackend(TEST_API_ORIGIN, fetch));
    const ws = createWsClient({ url: TEST_WS_URL });
    const quotes = createQuoteStore({ source: ws, schedule: () => undefined });
    const store = createTradingStore({
      source: tradingSourceOf(ws),
      quoteStore: quotes,
      loadState: () => client.call('accountState'),
      // Commit on every frame at once; the test reads each commit.
      schedule: (flush) => queueMicrotask(flush),
    });
    cleanups.push(() => {
      store.dispose();
      ws.close();
      mock.server.close();
      mock.orders.dispose();
      mock.adapter.dispose();
    });

    await login(client, '8500000001');
    await store.start();
    store.focus('INFY');
    const stopQuotes = quotes.subscribe('INFY', 'NSE', () => undefined);
    cleanups.push(stopQuotes);
    await expect.poll(() => store.getState().status).toBe('ready');

    const start = await infy(client);
    const limit = start.ltp - 5;
    const placing = store.begin({ kind: 'place', clientOrderId: 'c_t10_1' });
    const placed = await client.call('orderPlace', {
      body: {
        token: start.token,
        side: 'BUY',
        type: 'LIMIT',
        product: 'INTRADAY',
        qty: 3,
        price: limit,
        clientOrderId: 'c_t10_1',
      },
    });
    placing.ack(placed);
    await expect.poll(() => store.getState().pending).toEqual([]);

    // Each commit is checked for agreement: a filled order never shows without its position.
    const disagreements: string[] = [];
    store.subscribe(() => {
      const state = store.getState();
      const filled = state.orders.find((o) => o.id === placed.id)?.status === 'EXECUTED';
      const held = state.positions.find((p) => p.token === start.token)?.netQty === 3;
      if (filled !== held) disagreements.push(`seq ${String(state.seq)}`);
    });

    for (let i = 0; i < 2_000 && (await infy(client)).ltp > limit; i += 1) mock.adapter.tick();
    await expect
      .poll(() => store.getState().orders.find((o) => o.id === placed.id)?.status)
      .toBe('EXECUTED');
    const state = store.getState();
    expect(state.positions.find((p) => p.token === start.token)?.netQty).toBe(3);
    expect(state.funds?.available).toBeLessThan(state.funds?.openingBalance ?? 0);
    expect(state.depth?.symbol).toBe('INFY');
    expect(quotes.get('INFY')?.quote.ltp).toBeLessThanOrEqual(limit);
    expect(disagreements).toEqual([]);
    expect(state.seq).toBe((await client.call('accountState')).seq);
  }, 30_000);
});
