import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { healthRoutes } from './modules/health/routes.js';

/**
 * Builds the Fastify app without starting it, so tests can use `app.inject()`.
 */
export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);
  app.register(healthRoutes, { prefix: '/v1' });
  return app;
}
