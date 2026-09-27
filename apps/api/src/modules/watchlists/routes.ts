import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AppDeps } from '../../deps.js';
import { registerRoute } from '../../http/registerRoute.js';
import { authContextOf, createAuthenticate } from '../auth/authenticate.js';
import { createSessionService } from '../auth/sessionService.js';
import { createWatchlistService } from './service.js';

/**
 * Watchlist routes (T-115): list, create, rename, delete and reorder lists; add, remove and reorder
 * stocks. Every route needs a session (and, with the session cookie, the CSRF token); a user only
 * ever sees their own lists, and another user's list id answers 404.
 */
export const watchlistRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const authenticate = createAuthenticate(
      createSessionService({
        clock: deps.clock,
        repo: deps.repos.auth,
        users: deps.repos.users,
        secret: deps.jwtSecret,
      }),
    );
    const watchlists = createWatchlistService({
      clock: deps.clock,
      repo: deps.repos.watchlists,
      market: deps.market,
    });
    const userOf = (request: FastifyRequest) => authContextOf(request).user.id;
    const options = { authenticate };

    registerRoute(
      app,
      'watchlistsList',
      async ({ request }) => ({ items: await watchlists.list(userOf(request)) }),
      options,
    );

    registerRoute(
      app,
      'watchlistCreate',
      ({ request, body }) => watchlists.create(userOf(request), body.name),
      options,
    );

    registerRoute(
      app,
      'watchlistsReorder',
      async ({ request, body }) => ({ items: await watchlists.reorder(userOf(request), body.ids) }),
      options,
    );

    registerRoute(
      app,
      'watchlistRename',
      ({ request, params, body }) => watchlists.rename(userOf(request), params.id, body.name),
      options,
    );

    registerRoute(
      app,
      'watchlistDelete',
      async ({ request, params }) => {
        await watchlists.remove(userOf(request), params.id);
        return { ok: true as const };
      },
      options,
    );

    registerRoute(
      app,
      'watchlistItemAdd',
      ({ request, params, body }) => watchlists.addItem(userOf(request), params.id, body.token),
      options,
    );

    registerRoute(
      app,
      'watchlistItemRemove',
      ({ request, params }) => watchlists.removeItem(userOf(request), params.id, params.token),
      options,
    );

    registerRoute(
      app,
      'watchlistItemsReorder',
      ({ request, params, body }) =>
        watchlists.reorderItems(userOf(request), params.id, body.tokens),
      options,
    );
  };
