import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../../deps.js';
import { registerRoute } from '../../http/registerRoute.js';

/** Version string the health route reports; bumped with releases. */
export const API_VERSION = '0.0.0';

export const healthRoutes =
  ({ clock }: Pick<AppDeps, 'clock'>): FastifyPluginAsync =>
  async (app) => {
    registerRoute(app, 'health', () => ({
      status: 'ok',
      version: API_VERSION,
      time: clock.now().toISOString(),
    }));
  };
