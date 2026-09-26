import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { createDeps, type AppDeps, type DepsOverrides } from './deps.js';
import { installErrorHandling } from './http/errorHandler.js';
import { healthRoutes } from './modules/health/routes.js';

export type AppOptions = {
  logger?: FastifyServerOptions['logger'];
  /** Injected clock and repos; anything left out gets its default (system clock, in-memory repos). */
  deps?: DepsOverrides;
};

export type App = FastifyInstance & { deps: AppDeps };

/**
 * Builds the Fastify app without starting it, so tests can use `app.inject()`.
 * Route paths come from the contracts route map and already include `/v1`.
 */
export function buildApp(options: AppOptions = {}): App {
  const app = Fastify(options.logger === undefined ? {} : { logger: options.logger });
  const deps = createDeps(options.deps);
  installErrorHandling(app);
  app.register(healthRoutes(deps));
  return Object.assign(app, { deps });
}
