import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../../deps.js';
import { notFound } from '../../http/apiError.js';
import { registerRoute } from '../../http/registerRoute.js';

/**
 * Public market routes over the boot-time market data adapter (T-061). Unknown ids answer
 * 404 NOT_FOUND with the same messages as the MSW handlers.
 */
export const marketRoutes =
  ({ market }: Pick<AppDeps, 'market'>): FastifyPluginAsync =>
  async (app) => {
    registerRoute(app, 'marketIndices', async () => ({ items: await market.getIndices() }));

    registerRoute(app, 'marketLists', async () => ({ items: await market.getStockLists() }));

    registerRoute(
      app,
      'marketList',
      async ({ params }) => (await market.getStockList(params.id)) ?? notFound(`List ${params.id}`),
    );

    registerRoute(
      app,
      'marketMovers',
      async ({ query }) =>
        (await market.getMovers(query.index, query.direction, query.limit)) ??
        notFound(`Index ${query.index}`),
    );

    registerRoute(app, 'marketQuotes', async ({ query }) => ({
      items: await market.getQuotes(query.symbols, query.exchange),
    }));
  };
