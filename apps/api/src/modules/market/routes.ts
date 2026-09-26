import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../../deps.js';
import { notFound } from '../../http/apiError.js';
import { registerRoute } from '../../http/registerRoute.js';

/**
 * Public market routes over the boot-time market data adapter (T-061, T-062). Unknown ids answer
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

    registerRoute(app, 'marketSearch', async ({ query }) => ({
      items: await market.search(query.q, query.limit),
    }));

    registerRoute(
      app,
      'instrument',
      async ({ params, query }) =>
        (await market.getInstrument(params.symbol, query.exchange)) ??
        notFound(`Symbol ${params.symbol}`),
    );

    registerRoute(
      app,
      'instrumentCandles',
      async ({ params, query }) =>
        (await market.getCandles(params.symbol, query.range, query.exchange)) ??
        notFound(`Symbol ${params.symbol}`),
    );

    // Indices do not trade, so depth and stats are 404 for them as for unknown symbols.
    registerRoute(
      app,
      'instrumentDepth',
      async ({ params, query }) =>
        (await market.getDepth(params.symbol, query.exchange)) ??
        notFound(`Depth for ${params.symbol}`),
    );

    registerRoute(
      app,
      'instrumentStats',
      async ({ params, query }) =>
        (await market.getStats(params.symbol, query.exchange)) ??
        notFound(`Stats for ${params.symbol}`),
    );
  };
