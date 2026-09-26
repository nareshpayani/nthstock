import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { installErrorHandling } from './http/errorHandler.js';
import { healthRoutes } from './modules/health/routes.js';

/**
 * Builds the Fastify app without starting it, so tests can use `app.inject()`.
 * Route paths come from the contracts route map and already include `/v1`.
 */
export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);
  installErrorHandling(app);
  app.register(healthRoutes);
  return app;
}
