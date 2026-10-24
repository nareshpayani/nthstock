import type { ApiClient } from '@nthstock/apiClient';
import type { CandleInterval, CandleRange, Exchange } from '@nthstock/contracts';
import { queryOptions } from '@tanstack/react-query';
import { resolveInterval } from '../model/ranges';

export type CandlesParams = {
  symbol: string;
  range: CandleRange;
  exchange?: Exchange | undefined;
  /** Bar size (NSTOCK-0343); the range's own when left out. */
  interval?: CandleInterval | undefined;
};

export const chartKeys = {
  all: ['charts'] as const,
  candles: (params: CandlesParams) => ['charts', 'candles', params] as const,
};

/** Intraday bars move every minute; longer ranges change once a day. */
const staleTimeFor = (range: CandleRange) => (range === '1D' ? 60_000 : 5 * 60_000);

/** `GET /v1/market/instruments/:symbol/candles?range=` (ADR 0005 queryOptions factory). */
export function candlesQuery(api: ApiClient, params: CandlesParams) {
  const { symbol, range, exchange } = params;
  // The key always names the bar size, so the default and an explicit one share a cache entry.
  const interval = resolveInterval(range, params.interval);
  return queryOptions({
    queryKey: chartKeys.candles({ symbol, range, exchange, interval }),
    queryFn: ({ signal }) =>
      api.request('instrumentCandles', {
        params: { symbol },
        query: { range, interval, ...(exchange ? { exchange } : {}) },
        signal,
      }),
    staleTime: staleTimeFor(range),
  });
}
