import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AppDeps } from '../../deps.js';
import { registerRoute } from '../../http/registerRoute.js';
import { authContextOf, createAuthenticate } from '../auth/authenticate.js';
import { createSessionService } from '../auth/sessionService.js';
import { createPortfolioService } from './service.js';

/**
 * Positions, holdings and portfolio summary routes (T-141). Each needs a session and answers only
 * with the caller's own paper account.
 */
export const portfolioRoutes =
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
    const portfolio = createPortfolioService({ orders: deps.orders });
    const userOf = (request: FastifyRequest) => authContextOf(request).user.id;
    const options = { authenticate };

    registerRoute(
      app,
      'positionsList',
      ({ request }) => portfolio.positions(userOf(request)),
      options,
    );
    registerRoute(
      app,
      'holdingsList',
      ({ request }) => portfolio.holdings(userOf(request)),
      options,
    );
    registerRoute(
      app,
      'portfolioSummary',
      ({ request }) => portfolio.summary(userOf(request)),
      options,
    );
  };
