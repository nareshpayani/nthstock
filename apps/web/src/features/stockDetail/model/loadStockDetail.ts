import { isApiError, type ApiClient } from '@nthstock/apiClient';
import type { CandleRange, Exchange, Instrument } from '@nthstock/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { candlesQuery } from '@/features/charts';
import {
  depthQuery,
  instrumentQuery,
  profileQuery,
  quoteSnapshotQuery,
  statsQuery,
} from '../api/stockDetailQueries';
import { DEFAULT_STOCK_RANGE } from './stockDetailSearch';

export type LoadStockDetailParams = {
  symbol: string;
  exchange?: Exchange | undefined;
  range?: CandleRange | undefined;
};

/** A symbol the API does not know (404) or cannot be a symbol at all (400). */
const isMissing = (error: unknown) =>
  isApiError(error) && error.kind === 'http' && (error.status === 404 || error.status === 400);

/**
 * Route loader work for /stocks/:symbol (T-105). Waits only for the instrument, which decides
 * between the page and not-found; the quote snapshot, candles, stats, depth
 * and profile start in parallel and
 * are not awaited, so each section shows its own skeleton instead of holding up the page.
 * Resolves `null` for an unknown symbol; any other failure (offline, 5xx) rejects, so the route
 * shows its error state with a retry.
 */
export async function loadStockDetail(
  queryClient: QueryClient,
  api: ApiClient,
  { symbol, exchange, range }: LoadStockDetailParams,
): Promise<Instrument | null> {
  let instrument: Instrument;
  try {
    instrument = await queryClient.ensureQueryData(instrumentQuery(api, { symbol, exchange }));
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  const listed = { symbol: instrument.symbol, exchange: instrument.exchange };
  void queryClient.prefetchQuery(quoteSnapshotQuery(api, listed));
  void queryClient.prefetchQuery(
    candlesQuery(api, { ...listed, range: range ?? DEFAULT_STOCK_RANGE }),
  );
  if (instrument.type === 'EQUITY') {
    void queryClient.prefetchQuery(statsQuery(api, listed));
    void queryClient.prefetchQuery(depthQuery(api, listed));
    void queryClient.prefetchQuery(profileQuery(api, listed));
  }
  return instrument;
}
