import { setupServer } from 'msw/node';
import {
  createMockHandlers,
  type AuthMockOptions,
  type OrdersMockOptions,
  type WatchlistMockOptions,
} from './handlers';
import { setMockLatency } from './handlerKit';
import { createMockMarket, type MockMarketOptions } from './marketAdapter';

/** Origin and WebSocket URL the Vitest server answers on. */
export const TEST_API_ORIGIN = 'http://api.test';
export const TEST_WS_URL = 'ws://api.test/ws';

/**
 * MSW node server for Vitest (T-050): the same handlers as the browser, no latency.
 * Call `listen()` in beforeAll and `close()` in afterAll; dispose the adapter too. `orders` is the
 * orders mock, for scripted prices (`pinPrice`).
 */
export function createMockServer(
  options: MockMarketOptions & {
    flushMs?: number;
    auth?: AuthMockOptions;
    watchlists?: WatchlistMockOptions;
    orders?: OrdersMockOptions;
  } = {},
) {
  setMockLatency(0);
  const adapter = createMockMarket(options);
  const { handlers, orders } = createMockHandlers({
    adapter,
    wsUrl: TEST_WS_URL,
    ...(options.flushMs === undefined ? {} : { stream: { flushMs: options.flushMs } }),
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.watchlists ? { watchlists: options.watchlists } : {}),
    ...(options.orders ? { orders: options.orders } : {}),
  });
  const server = setupServer(...handlers);
  // `adapter.dispose()` stays the caller's; the orders mock only holds adapter subscriptions.
  return { server, adapter, orders };
}
