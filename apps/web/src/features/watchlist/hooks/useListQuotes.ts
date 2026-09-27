import { quoteKey } from '@nthstock/apiClient';
import type { Exchange, Quote, WatchlistItem } from '@nthstock/contracts';
import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '@/shared/lib/apiClientContext';
import { listQuotesQuery } from '../api/watchlistsQuery';

const EXCHANGES: readonly Exchange[] = ['NSE', 'BSE'];

/** How long a list's REST prices stay fresh; live ticks take over for rows on screen. */
export const LIST_QUOTES_STALE_MS = 10_000;

/** Module-level, so TanStack Query keeps the combined map while the results do not change. */
function byKey(results: UseQueryResult<readonly Quote[]>[]): ReadonlyMap<string, Quote> {
  const map = new Map<string, Quote>();
  for (const result of results) {
    for (const quote of result.data ?? []) map.set(quoteKey(quote.symbol, quote.exchange), quote);
  }
  return map;
}

/**
 * REST prices for every stock of a list, keyed `EXCHANGE:SYMBOL` (see `listQuotesQuery`).
 * `refetchMs` keeps them fresh while a price sort needs rows that are off screen.
 */
export function useListQuotes(
  items: readonly Pick<WatchlistItem, 'symbol' | 'exchange'>[],
  refetchMs: number | false = false,
): ReadonlyMap<string, Quote> {
  const api = useApiClient();
  const groups = EXCHANGES.map((exchange) => ({
    exchange,
    symbols: items.filter((item) => item.exchange === exchange).map((item) => item.symbol),
  })).filter((group) => group.symbols.length > 0);

  return useQueries({
    queries: groups.map(({ exchange, symbols }) => ({
      ...listQuotesQuery(api, exchange, symbols),
      staleTime: LIST_QUOTES_STALE_MS,
      refetchInterval: refetchMs,
    })),
    combine: byKey,
  });
}
