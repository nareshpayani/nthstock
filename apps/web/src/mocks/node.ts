import { setupServer } from 'msw/node';
import { createHandlers } from './handlers';
import { setMockLatency } from './handlerKit';
import { createMockMarket, type MockMarketOptions } from './marketAdapter';

/** Origin and WebSocket URL the Vitest server answers on. */
export const TEST_API_ORIGIN = 'http://api.test';
export const TEST_WS_URL = 'ws://api.test/ws';

/**
 * MSW node server for Vitest (T-050): the same handlers as the browser, no latency.
 * Call `listen()` in beforeAll and `close()` in afterAll; dispose the adapter too.
 */
export function createMockServer(options: MockMarketOptions & { flushMs?: number } = {}) {
  setMockLatency(0);
  const adapter = createMockMarket(options);
  const server = setupServer(
    ...createHandlers({
      adapter,
      wsUrl: TEST_WS_URL,
      ...(options.flushMs === undefined ? {} : { stream: { flushMs: options.flushMs } }),
    }),
  );
  return { server, adapter };
}
