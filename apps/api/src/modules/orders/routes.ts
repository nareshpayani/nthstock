import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AppDeps } from '../../deps.js';
import { registerRoute } from '../../http/registerRoute.js';
import { authContextOf, createAuthenticate, createSessionService } from '../auth/index.js';

/**
 * Order routes (T-131): place, modify, cancel, get and list by status (the funds routes are in the
 * funds module). Every route needs a session (and, for writes, the CSRF token); a user only ever sees
 * their own orders, and another user's order id answers 404.
 */
export const orderRoutes =
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
    const { orders } = deps;
    const userOf = (request: FastifyRequest) => authContextOf(request).user.id;
    const options = { authenticate };

    registerRoute(
      app,
      'ordersList',
      ({ request, query }) => orders.list(userOf(request), query),
      options,
    );

    registerRoute(
      app,
      'orderGet',
      ({ request, params }) => orders.get(userOf(request), params.id),
      options,
    );

    registerRoute(
      app,
      'orderHistory',
      ({ request, params }) => orders.history(userOf(request), params.id),
      options,
    );

    registerRoute(
      app,
      'orderPlace',
      ({ request, body }) => orders.place(userOf(request), body),
      options,
    );

    registerRoute(
      app,
      'orderModify',
      ({ request, params, body }) => orders.modify(userOf(request), params.id, body),
      options,
    );

    registerRoute(
      app,
      'orderCancel',
      ({ request, params }) => orders.cancel(userOf(request), params.id),
      options,
    );
  };
