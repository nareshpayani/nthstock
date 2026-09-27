import type { ApiClient } from '@nthstock/apiClient';
import type { Exchange } from '@nthstock/contracts';
import { queryOptions } from '@tanstack/react-query';

/** The instrument the ticket trades. */
export type TicketInstrument = { symbol: string; exchange: Exchange };

/** Query keys (ADR 0005): `['orderTicket', entity, params]`. */
export const ticketKeys = {
  all: ['orderTicket'] as const,
  instrument: (params: TicketInstrument) => ['orderTicket', 'instrument', params] as const,
  quote: (params: TicketInstrument) => ['orderTicket', 'quote', params] as const,
  stats: (params: TicketInstrument) => ['orderTicket', 'stats', params] as const,
  depth: (params: TicketInstrument) => ['orderTicket', 'depth', params] as const,
};

/** How often the ticket's depth panel refreshes while the market is open. */
export const TICKET_DEPTH_REFRESH_MS = 2_000;

const key = ({ symbol, exchange }: TicketInstrument) => ({ symbol, exchange });

/** `GET /v1/market/instruments/:symbol`: the token an order carries, and the tick size. */
export function ticketInstrumentQuery(api: ApiClient, params: TicketInstrument) {
  return queryOptions({
    queryKey: ticketKeys.instrument(key(params)),
    queryFn: ({ signal }) =>
      api.request('instrument', {
        params: { symbol: params.symbol },
        query: { exchange: params.exchange },
        signal,
      }),
    staleTime: 30 * 60_000,
  });
}

/** The REST quote snapshot: the price to prefill until the first live tick. `null` without one. */
export function ticketQuoteQuery(api: ApiClient, params: TicketInstrument) {
  return queryOptions({
    queryKey: ticketKeys.quote(key(params)),
    queryFn: async ({ signal }) => {
      const response = await api.request('marketQuotes', {
        query: { symbols: params.symbol, exchange: params.exchange },
        signal,
      });
      return response.items[0] ?? null;
    },
    staleTime: 15_000,
  });
}

/** Key stats: the ticket reads today's circuit band from them for the limit-price check. */
export function ticketStatsQuery(api: ApiClient, params: TicketInstrument) {
  return queryOptions({
    queryKey: ticketKeys.stats(key(params)),
    queryFn: ({ signal }) =>
      api.request('instrumentStats', {
        params: { symbol: params.symbol },
        query: { exchange: params.exchange },
        signal,
      }),
    staleTime: 60_000,
  });
}

/** Top-5 depth for the ticket's mini-panel (T-137). */
export function ticketDepthQuery(api: ApiClient, params: TicketInstrument) {
  return queryOptions({
    queryKey: ticketKeys.depth(key(params)),
    queryFn: ({ signal }) =>
      api.request('instrumentDepth', {
        params: { symbol: params.symbol },
        query: { exchange: params.exchange },
        signal,
      }),
    staleTime: TICKET_DEPTH_REFRESH_MS,
  });
}
