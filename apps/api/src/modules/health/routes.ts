import type { FastifyPluginAsync } from 'fastify';
import { registerRoute } from '../../http/registerRoute.js';

/** Version string the health route reports; bumped with releases. */
export const API_VERSION = '0.0.0';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  registerRoute(app, 'health', () => ({
    status: 'ok',
    version: API_VERSION,
    time: new Date().toISOString(),
  }));
};
