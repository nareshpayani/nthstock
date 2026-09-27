import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Redis } from 'ioredis';
import { createDeps, type AppDeps, type DepsOverrides } from './deps.js';
import { installCsrfCheck } from './http/csrf.js';
import { installErrorHandling } from './http/errorHandler.js';
import { installSecurityHeaders } from './http/securityHeaders.js';
import { authRoutes } from './modules/auth/routes.js';
import { fundsRoutes } from './modules/funds/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { marketRoutes } from './modules/market/routes.js';
import { orderRoutes } from './modules/orders/routes.js';
import { portfolioRoutes } from './modules/portfolio/routes.js';
import {
  startOrderUpdatePublisher,
  type OrderUpdatePublisher,
} from './modules/orders/updatePublisher.js';
import { testControlRoutes, type TestControls } from './modules/testControls/routes.js';
import { watchlistRoutes } from './modules/watchlists/routes.js';
import type { Publisher } from './ticks/publisher.js';
import { startTickPump, type TickPump } from './ticks/tickPump.js';

export type AppOptions = {
  logger?: FastifyServerOptions['logger'];
  /** Injected clock, repos and market adapter; anything left out gets its default. */
  deps?: DepsOverrides;
  /** Requests per minute per client IP across all routes (CLAUDE.md security baseline). */
  rateLimitPerMinute?: number;
  /**
   * Keeps rate-limit counters in Redis so every API instance shares them. Left out, counters are
   * per process (tests, REST-only dev). The caller owns the client.
   */
  rateLimitRedis?: Redis;
  /**
   * Publishes every adapter tick here once the app is ready (T-071); apps/realtime fans them out.
   * Left out, the API serves REST only. The app closes the publisher when it closes.
   */
  tickPublisher?: Publisher;
  /**
   * Publishes every order change to its user's Redis channel (T-133); apps/realtime delivers it.
   * May be the same publisher as `tickPublisher`. The app closes it when it closes.
   */
  orderPublisher?: Publisher;
  /**
   * How often every paper account is synced, so AMO release (9:15 IST) and end of day run and are
   * pushed without a tick or a request. `null` turns it off (tests drive time themselves).
   */
  orderSweepMs?: number | null;
  /**
   * Registers the `/v1/__test` clock and price routes (T-162) for E2E suites. Left out (always, in
   * production), those paths answer 404. `server.ts` passes it only for `NODE_ENV=test` with
   * `ENABLE_TEST_CONTROLS=true`; `setTime` must move `deps.clock`.
   */
  testControls?: TestControls;
};

export const DEFAULT_RATE_LIMIT_PER_MINUTE = 600;
export const DEFAULT_ORDER_SWEEP_MS = 15_000;

export type App = FastifyInstance & { deps: AppDeps };

/**
 * Builds the Fastify app without starting it, so tests can use `app.inject()`.
 * Route paths come from the contracts route map and already include `/v1`.
 */
export function buildApp(options: AppOptions = {}): App {
  const app = Fastify(options.logger === undefined ? {} : { logger: options.logger });
  const deps = createDeps(options.deps);
  if (options.testControls && deps.production) {
    throw new Error('Test controls (/v1/__test) cannot be enabled in production');
  }
  installErrorHandling(app);
  // CSP, X-Frame-Options DENY and friends on every reply; HSTS outside local (T-173).
  installSecurityHeaders(app, { hsts: deps.production });
  // Global per-IP limit; the auth routes set tighter ones (T-082). A 429 becomes an ApiError
  // RATE_LIMITED via the error handler.
  app.register(rateLimit, {
    global: true,
    max: options.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    // With Redis, a Redis outage lets requests through (skipOnError) rather than taking the API
    // down; the OTP throttle and the OTP and PIN attempt counters still hold.
    ...(options.rateLimitRedis
      ? { redis: options.rateLimitRedis, nameSpace: 'nthstock:rate-limit:', skipOnError: true }
      : {}),
  });
  installCsrfCheck(app);
  app.addHook('onClose', async () => {
    deps.dispose();
  });
  const publisher = options.tickPublisher;
  if (publisher) {
    let pump: TickPump | null = null;
    app.addHook('onReady', async () => {
      pump = await startTickPump({ market: deps.market, publisher, log: app.log });
    });
    app.addHook('onClose', async () => {
      pump?.stop();
    });
  }
  const orderPublisher = options.orderPublisher;
  if (orderPublisher) {
    let updates: OrderUpdatePublisher | null = null;
    app.addHook('onReady', async () => {
      updates = startOrderUpdatePublisher({
        orders: deps.orders,
        publisher: orderPublisher,
        log: app.log,
      });
    });
    app.addHook('onClose', async () => {
      updates?.stop();
    });
  }
  // Each publisher is closed once, even when ticks and order updates share one.
  for (const owned of new Set([publisher, orderPublisher])) {
    if (owned) app.addHook('onClose', () => owned.close());
  }
  const sweepMs =
    options.orderSweepMs === undefined ? DEFAULT_ORDER_SWEEP_MS : options.orderSweepMs;
  if (sweepMs !== null) {
    let sweeper: ReturnType<typeof setInterval> | null = null;
    app.addHook('onReady', async () => {
      sweeper = setInterval(() => {
        deps.orders.sweep().catch((error: unknown) => {
          app.log.error({ error }, 'order sweep failed');
        });
      }, sweepMs);
      sweeper.unref();
    });
    app.addHook('onClose', async () => {
      if (sweeper) clearInterval(sweeper);
    });
  }
  app.register(healthRoutes(deps));
  app.register(marketRoutes(deps));
  app.register(authRoutes(deps));
  app.register(watchlistRoutes(deps));
  app.register(orderRoutes(deps));
  app.register(portfolioRoutes(deps));
  app.register(fundsRoutes(deps));
  if (options.testControls) app.register(testControlRoutes(deps, options.testControls));
  return Object.assign(app, { deps });
}
