import {
  TEST_CONTROL_PATHS,
  TestClockRequest,
  TestPriceRequest,
  type TestClockResponse,
  type TestPriceResponse,
} from '@nthstock/contracts';
import type { MarketDataAdapter } from '@nthstock/marketData';
import { http, HttpResponse, type HttpHandler } from 'msw';
import { errorResponse } from './handlerKit';
import type { OrdersMock } from './handlers';

/**
 * The MSW equivalents of apps/api's `/v1/__test` routes (T-162): a clock override and scripted
 * prices, so E2E suites drive both modes the same way.
 *
 * This module ships only in a build made with `VITE_TEST_CONTROLS=true` (the Playwright build):
 * main.tsx imports it behind that build-time constant, so every other build, msw or api mode, has
 * no `/v1/__test` handler and no code for one (scripts/checkBuild.mjs fails a build that does).
 */
export type TestControls = {
  /** Epoch ms: the page clock plus the offset `POST /v1/__test/clock` set. The mocks' clock. */
  now(): number;
  /** The two handlers, over the orders mock and the adapter the other handlers use. */
  handlers(deps: { orders: OrdersMock; adapter: MarketDataAdapter }): HttpHandler[];
};

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return (await request.json()) as unknown;
  } catch {
    return null;
  }
};

const invalid = () => errorResponse(400, 'VALIDATION_ERROR', 'Invalid request body');

export function createTestControls(): TestControls {
  let offset = 0;
  const now = () => Date.now() + offset;
  return {
    now,
    handlers: ({ orders, adapter }) => [
      http.post(`*${TEST_CONTROL_PATHS.clock}`, async ({ request }) => {
        const parsed = TestClockRequest.safeParse(await readJson(request));
        if (!parsed.success) return invalid();
        offset = Date.parse(parsed.data.at) - Date.now();
        // Like apps/api: sync every account now, so a jump past 9:15 IST releases AMOs at once.
        await orders.sweep();
        const body: TestClockResponse = { now: new Date(now()).toISOString() };
        return HttpResponse.json(body);
      }),
      http.post(`*${TEST_CONTROL_PATHS.price}`, async ({ request }) => {
        const parsed = TestPriceRequest.safeParse(await readJson(request));
        if (!parsed.success) return invalid();
        const { symbol, ltp } = parsed.data;
        const instrument = await adapter.getInstrument(symbol);
        if (!instrument) return errorResponse(404, 'NOT_FOUND', `${symbol} not found`);
        orders.pinPrice(instrument.token, ltp);
        const body: TestPriceResponse = { symbol, token: instrument.token, ltp };
        return HttpResponse.json(body);
      }),
    ],
  };
}
