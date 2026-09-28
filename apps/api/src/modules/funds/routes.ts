import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AppDeps } from '../../deps.js';
import { registerRoute } from '../../http/registerRoute.js';
import { authContextOf, createAuthenticate } from '../auth/authenticate.js';
import { createSessionService } from '../auth/sessionService.js';
import { createFundsService } from './service.js';

/**
 * Funds routes (T-131, T-155): the summary, the paginated ledger and the reset. Each needs a
 * session (the reset, a POST, also the CSRF token) and acts only on the caller's own paper account.
 * The reset body must be `{ "confirm": "RESET" }` (`ResetRequest`), else 400.
 */
export const fundsRoutes =
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
    const funds = createFundsService({ orders: deps.orders });
    const userOf = (request: FastifyRequest) => authContextOf(request).user.id;
    const options = { authenticate };

    registerRoute(app, 'fundsSummary', ({ request }) => funds.summary(userOf(request)), options);

    registerRoute(
      app,
      'fundsLedger',
      ({ request, query }) => funds.ledger(userOf(request), query),
      options,
    );

    registerRoute(
      app,
      'fundsReset',
      ({ request, body }) => funds.reset(userOf(request), body),
      options,
    );
  };
