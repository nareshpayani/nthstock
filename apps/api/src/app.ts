import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { createDeps, type AppDeps, type DepsOverrides } from './deps.js';
import { installErrorHandling } from './http/errorHandler.js';
import { healthRoutes } from './modules/health/routes.js';
import { marketRoutes } from './modules/market/routes.js';

export type AppOptions = {
  logger?: FastifyServerOptions['logger'];
  /** Injected clock, repos and market adapter; anything left out gets its default. */
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
  app.addHook('onClose', async () => {
    deps.dispose();
  });
  app.register(healthRoutes(deps));
  app.register(marketRoutes(deps));
  return Object.assign(app, { deps });
}
