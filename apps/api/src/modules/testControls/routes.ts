import {
  TEST_CONTROL_PATHS,
  TestClockRequest,
  TestPriceRequest,
  type TestClockResponse,
  type TestPriceResponse,
} from '@nthstock/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { ApiHttpError } from '../../http/apiError.js';

/** What the test routes drive: the app's clock (an `offsetClock`, injected as `deps.clock`). */
export type TestControls = {
  /** Jumps the app's clock to `at` (ISO UTC); it runs on from there. */
  setTime(at: string): void;
};

const parse = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiHttpError(400, 'VALIDATION_ERROR', 'Invalid request body', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
};

/**
 * `/v1/__test` routes (T-162), registered by `buildApp` only when it is given `testControls`,
 * which `server.ts` does only for `NODE_ENV=test` with `ENABLE_TEST_CONTROLS=true`. They carry no
 * session check on purpose (E2E drives them from outside the browser), so they must never be
 * reachable anywhere else: `buildApp` refuses them in production as a second guard.
 *
 * - clock: the app's clock jumps to `at`, then every paper account syncs, so a jump past 9:15 IST
 *   releases AMOs at once instead of on the next 15 s sweep.
 * - price: a scripted tick; the paper engines see `ltp` for `symbol` from now on, and orders it
 *   crosses fill at once.
 */
export const testControlRoutes =
  (
    deps: Pick<AppDeps, 'clock' | 'market' | 'orders'>,
    controls: TestControls,
  ): FastifyPluginAsync =>
  async (app) => {
    app.post(TEST_CONTROL_PATHS.clock, async (request): Promise<TestClockResponse> => {
      const { at } = parse(TestClockRequest, request.body);
      controls.setTime(at);
      await deps.orders.sweep();
      return { now: deps.clock.now().toISOString() };
    });

    app.post(TEST_CONTROL_PATHS.price, async (request): Promise<TestPriceResponse> => {
      const { symbol, ltp } = parse(TestPriceRequest, request.body);
      const instrument = await deps.market.getInstrument(symbol);
      if (!instrument) throw new ApiHttpError(404, 'NOT_FOUND', `${symbol} not found`);
      deps.orders.pinPrice(instrument.token, ltp);
      return { symbol, token: instrument.token, ltp };
    });
  };
