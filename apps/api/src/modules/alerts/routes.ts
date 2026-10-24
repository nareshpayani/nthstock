import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AppDeps } from '../../deps.js';
import { registerRoute } from '../../http/registerRoute.js';
import { authContextOf, createAuthenticate, createSessionService } from '../auth/index.js';

/**
 * Price alert and notification routes (NSTOCK-0344). Every route needs a session (and, for writes,
 * the CSRF token); a user only sees their own alerts, and another user's alert id answers 404.
 */
export const alertRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const authenticate = createAuthenticate(
      createSessionService({
        clock: deps.clock,
        repo: deps.repos.auth,
        users: deps.repos.users,
        secret: deps.jwtSecret,
        audit: deps.repos.audit,
      }),
    );
    const { alerts } = deps;
    const userOf = (request: FastifyRequest) => authContextOf(request).user.id;
    const options = { authenticate };

    registerRoute(app, 'priceAlertsList', ({ request }) => alerts.list(userOf(request)), options);
    registerRoute(
      app,
      'priceAlertCreate',
      ({ request, body }) => alerts.create(userOf(request), body),
      options,
    );
    registerRoute(
      app,
      'priceAlertCancel',
      ({ request, params }) => alerts.cancel(userOf(request), params.id),
      options,
    );
    registerRoute(
      app,
      'notificationsList',
      ({ request }) => alerts.notifications(userOf(request)),
      options,
    );
    registerRoute(
      app,
      'notificationsMarkRead',
      ({ request, body }) => alerts.markRead(userOf(request), body.ids),
      options,
    );
  };
