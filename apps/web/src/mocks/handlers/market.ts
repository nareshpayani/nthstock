import type { MarketDataAdapter } from '@nthstock/marketData';
import type { HttpHandler } from 'msw';
import { defineRoute, notFound, type RouteHandlerOptions } from '../handlerKit';

/** Version string the mock health route reports. */
export const MOCK_VERSION = 'msw';

/**
 * REST handlers for the market routes (T-052), all served by one adapter instance so REST
 * snapshots and the WebSocket stream agree on prices.
 */
export function marketHandlers(
  adapter: MarketDataAdapter,
  options: RouteHandlerOptions = {},
): HttpHandler[] {
  return [
    defineRoute(
      'health',
      () => ({ status: 'ok', version: MOCK_VERSION, time: new Date().toISOString() }),
      options,
    ),
    defineRoute('marketIndices', async () => ({ items: await adapter.getIndices() }), options),
    defineRoute('marketLists', async () => ({ items: await adapter.getStockLists() }), options),
    defineRoute(
      'marketList',
      async ({ params }) =>
        (await adapter.getStockList(params.id)) ?? notFound(`List ${params.id}`),
      options,
    ),
    defineRoute(
      'marketMovers',
      async ({ query }) =>
        (await adapter.getMovers(query.index, query.direction, query.limit)) ??
        notFound(`Index ${query.index}`),
      options,
    ),
    defineRoute(
      'marketQuotes',
      async ({ query }) => ({ items: await adapter.getQuotes(query.symbols, query.exchange) }),
      options,
    ),
    defineRoute(
      'marketSearch',
      async ({ query }) => ({ items: await adapter.search(query.q, query.limit) }),
      options,
    ),
    defineRoute(
      'instrument',
      async ({ params, query }) =>
        (await adapter.getInstrument(params.symbol, query.exchange)) ??
        notFound(`Symbol ${params.symbol}`),
      options,
    ),
    defineRoute(
      'instrumentCandles',
      async ({ params, query }) =>
        (await adapter.getCandles(params.symbol, query.range, query.exchange)) ??
        notFound(`Symbol ${params.symbol}`),
      options,
    ),
    defineRoute(
      'instrumentDepth',
      async ({ params, query }) =>
        (await adapter.getDepth(params.symbol, query.exchange)) ??
        notFound(`Depth for ${params.symbol}`),
      options,
    ),
    defineRoute(
      'instrumentStats',
      async ({ params, query }) =>
        (await adapter.getStats(params.symbol, query.exchange)) ??
        notFound(`Stats for ${params.symbol}`),
      options,
    ),
  ];
}
