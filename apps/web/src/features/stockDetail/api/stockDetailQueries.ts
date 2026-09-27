import type { ApiClient } from '@nthstock/apiClient';
import type { Exchange } from '@nthstock/contracts';
import { queryOptions } from '@tanstack/react-query';

/** One instrument on one exchange; `exchange` omitted means "wherever it is listed". */
export type InstrumentParams = { symbol: string; exchange?: Exchange | undefined };

const withExchange = (exchange: Exchange | undefined) => (exchange ? { exchange } : {});

export const stockDetailKeys = {
  all: ['stockDetail'] as const,
  instrument: (params: InstrumentParams) =>
    [
      'stockDetail',
      'instrument',
      { symbol: params.symbol, ...withExchange(params.exchange) },
    ] as const,
  quote: (params: InstrumentParams) =>
    ['stockDetail', 'quote', { symbol: params.symbol, ...withExchange(params.exchange) }] as const,
  stats: (params: InstrumentParams) =>
    ['stockDetail', 'stats', { symbol: params.symbol, ...withExchange(params.exchange) }] as const,
  depth: (params: InstrumentParams) =>
    ['stockDetail', 'depth', { symbol: params.symbol, ...withExchange(params.exchange) }] as const,
  profile: (params: InstrumentParams) =>
    [
      'stockDetail',
      'profile',
      { symbol: params.symbol, ...withExchange(params.exchange) },
    ] as const,
};

/** How often market depth refreshes while it is on screen and the market is open (T-110). */
export const DEPTH_REFRESH_MS = 1_000;

/** `GET /v1/market/instruments/:symbol` (T-105). The symbol master rarely changes. */
export function instrumentQuery(api: ApiClient, params: InstrumentParams) {
  return queryOptions({
    queryKey: stockDetailKeys.instrument(params),
    queryFn: ({ signal }) =>
      api.request('instrument', {
        params: { symbol: params.symbol },
        query: withExchange(params.exchange),
        signal,
      }),
    staleTime: 30 * 60_000,
  });
}

/**
 * The REST quote snapshot (`GET /v1/market/quotes?symbols=`), shown until the first live tick
 * reaches the quote store. `null` when the feed has no quote for the symbol.
 */
export function quoteSnapshotQuery(api: ApiClient, params: InstrumentParams) {
  return queryOptions({
    queryKey: stockDetailKeys.quote(params),
    queryFn: async ({ signal }) => {
      const response = await api.request('marketQuotes', {
        query: { symbols: params.symbol, ...withExchange(params.exchange) },
        signal,
      });
      return response.items[0] ?? null;
    },
    staleTime: 15_000,
  });
}

/** `GET /v1/market/instruments/:symbol/stats` (T-109): key stats and fundamentals. */
export function statsQuery(api: ApiClient, params: InstrumentParams) {
  return queryOptions({
    queryKey: stockDetailKeys.stats(params),
    queryFn: ({ signal }) =>
      api.request('instrumentStats', {
        params: { symbol: params.symbol },
        query: withExchange(params.exchange),
        signal,
      }),
    staleTime: 60_000,
  });
}

/**
 * `GET /v1/market/instruments/:symbol/depth` (T-110): top-5 bids and offers. Fresh for one
 * refresh interval; the card decides when to poll.
 */
export function depthQuery(api: ApiClient, params: InstrumentParams) {
  return queryOptions({
    queryKey: stockDetailKeys.depth(params),
    queryFn: ({ signal }) =>
      api.request('instrumentDepth', {
        params: { symbol: params.symbol },
        query: withExchange(params.exchange),
        signal,
      }),
    staleTime: DEPTH_REFRESH_MS,
  });
}

/** `GET /v1/market/instruments/:symbol/profile` (T-111): about text, sector and indices. */
export function profileQuery(api: ApiClient, params: InstrumentParams) {
  return queryOptions({
    queryKey: stockDetailKeys.profile(params),
    queryFn: ({ signal }) =>
      api.request('instrumentProfile', {
        params: { symbol: params.symbol },
        query: withExchange(params.exchange),
        signal,
      }),
    staleTime: 30 * 60_000,
  });
}
