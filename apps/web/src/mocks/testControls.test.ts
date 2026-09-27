import { TEST_CONTROL_PATHS, TestClockResponse, TestPriceResponse } from '@nthstock/contracts';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockHandlers } from './handlers';
import { setMockLatency } from './handlerKit';
import { createMockMarket } from './marketAdapter';
import { TEST_API_ORIGIN, TEST_WS_URL } from './node';
import { createTestControls } from './testControls';

// T-162: the MSW equivalents of apps/api's /v1/__test routes, and their absence by default.
const adapter = createMockMarket();
const controls = createTestControls();
const { handlers, orders } = createMockHandlers({
  adapter,
  wsUrl: TEST_WS_URL,
  auth: { now: controls.now },
});
const server = setupServer(...controls.handlers({ orders, adapter }), ...handlers);

beforeAll(() => {
  setMockLatency(0);
  server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  server.close();
  orders.dispose();
  adapter.dispose();
});

const post = (path: string, body: unknown) =>
  fetch(`${TEST_API_ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('MSW test controls', () => {
  it('are not among the default handlers', () => {
    const paths = handlers.map((handler) =>
      String((handler as { info?: { path?: unknown } }).info?.path),
    );
    expect(paths.some((path) => path.includes('__test'))).toBe(false);
  });

  it('set the mocks clock', async () => {
    const response = await post(TEST_CONTROL_PATHS.clock, { at: '2030-01-07T04:30:00.000Z' });
    expect(response.status).toBe(200);
    const { now } = TestClockResponse.parse(await response.json());
    expect(now.slice(0, 13)).toBe('2030-01-07T04');
    expect(new Date(controls.now()).toISOString().slice(0, 13)).toBe('2030-01-07T04');
  });

  it('pin a price by symbol', async () => {
    const response = await post(TEST_CONTROL_PATHS.price, { symbol: 'INFY', ltp: 150_000 });
    expect(response.status).toBe(200);
    const pinned = TestPriceResponse.parse(await response.json());
    expect(pinned).toMatchObject({ symbol: 'INFY', ltp: 150_000 });
    expect(pinned.token).toBeGreaterThan(0);
  });

  it('reject a bad body (400) and an unknown symbol (404)', async () => {
    expect((await post(TEST_CONTROL_PATHS.clock, { at: 'soon' })).status).toBe(400);
    expect((await post(TEST_CONTROL_PATHS.clock, 'not json')).status).toBe(400);
    expect((await post(TEST_CONTROL_PATHS.price, { symbol: 'INFY', ltp: 0 })).status).toBe(400);
    expect((await post(TEST_CONTROL_PATHS.price, { symbol: 'NOPE', ltp: 5 })).status).toBe(404);
  });
});
