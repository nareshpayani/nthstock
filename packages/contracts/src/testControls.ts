import { z } from 'zod';
import { InstrumentToken, IsoUtc, Paise, TradingSymbol } from './primitives.js';

/**
 * Test-only controls (T-162): the clock override and scripted prices that E2E suites use, so
 * market hours, AMO release and limit fills never depend on when CI runs or on the random walk.
 *
 * These routes are NOT in the `routes` map on purpose: nothing generic (OpenAPI, the MSW handler
 * builder, the API client) ever picks them up. apps/api and apps/realtime register them only when
 * started with `NODE_ENV=test` and `ENABLE_TEST_CONTROLS=true` (both refuse the flag in production),
 * and the web app's MSW equivalents ship only in a build made with `VITE_TEST_CONTROLS=true`.
 * Everywhere else the paths answer 404.
 */
export const TEST_CONTROL_PATHS = {
  /** POST `TestClockRequest`: the backend clock jumps to `at` and runs on from there. */
  clock: '/v1/__test/clock',
  /** POST `TestPriceRequest`: the paper engines see `ltp` for `symbol` until the process ends. */
  price: '/v1/__test/price',
} as const;

/** The env flag that turns the controls on in apps/api and apps/realtime (with NODE_ENV=test). */
export const TEST_CONTROLS_ENV = 'ENABLE_TEST_CONTROLS';

export const TestClockRequest = z.object({ at: IsoUtc });
export type TestClockRequest = z.infer<typeof TestClockRequest>;

export const TestClockResponse = z.object({ now: IsoUtc });
export type TestClockResponse = z.infer<typeof TestClockResponse>;

export const TestPriceRequest = z.object({ symbol: TradingSymbol, ltp: Paise.positive() });
export type TestPriceRequest = z.infer<typeof TestPriceRequest>;

export const TestPriceResponse = z.object({
  symbol: TradingSymbol,
  token: InstrumentToken,
  ltp: Paise.positive(),
});
export type TestPriceResponse = z.infer<typeof TestPriceResponse>;
