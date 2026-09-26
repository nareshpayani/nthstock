import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { createDeps, type AppDeps, type DepsOverrides } from './deps.js';
import { installErrorHandling } from './http/errorHandler.js';
import { healthRoutes } from './modules/health/routes.js';
import { marketRoutes } from './modules/market/routes.js';

export type AppOptions = {
  logger?: FastifyServerOptions['logger'];
  /** Injected clock, repos and market adapter; anything left out gets its default. */
  deps?: DepsOverrides;
  /** Requests per minute per client IP across all routes (CLAUDE.md security baseline). */
  rateLimitPerMinute?: number;
};

export const DEFAULT_RATE_LIMIT_PER_MINUTE = 600;

export type App = FastifyInstance & { deps: AppDeps };

/**
 * Builds the Fastify app without starting it, so tests can use `app.inject()`.
 * Route paths come from the contracts route map and already include `/v1`.
 */
export function buildApp(options: AppOptions = {}): App {
  const app = Fastify(options.logger === undefined ? {} : { logger: options.logger });
  const deps = createDeps(options.deps);
  installErrorHandling(app);
  // Global per-IP limit; a 429 becomes an ApiError RATE_LIMITED via the error handler.
  // In-memory for now; the Redis store and per-user and auth-route limits come with T-082.
  app.register(rateLimit, {
    global: true,
    max: options.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
  });
  app.addHook('onClose', async () => {
    deps.dispose();
  });
  app.register(healthRoutes(deps));
  app.register(marketRoutes(deps));
  return Object.assign(app, { deps });
}
