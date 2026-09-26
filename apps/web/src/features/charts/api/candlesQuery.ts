import type { ApiClient } from '@nthstock/apiClient';
import type { CandleRange, Exchange } from '@nthstock/contracts';
import { queryOptions } from '@tanstack/react-query';

export type CandlesParams = { symbol: string; range: CandleRange; exchange?: Exchange };

export const chartKeys = {
  all: ['charts'] as const,
  candles: (params: CandlesParams) => ['charts', 'candles', params] as const,
};

/** Intraday bars move every minute; longer ranges change once a day. */
const staleTimeFor = (range: CandleRange) => (range === '1D' ? 60_000 : 5 * 60_000);

/** `GET /v1/market/instruments/:symbol/candles?range=` (ADR 0005 queryOptions factory). */
export function candlesQuery(api: ApiClient, params: CandlesParams) {
  const { symbol, range, exchange } = params;
  return queryOptions({
    queryKey: chartKeys.candles(params),
    queryFn: ({ signal }) =>
      api.request('instrumentCandles', {
        params: { symbol },
        query: { range, ...(exchange ? { exchange } : {}) },
        signal,
      }),
    staleTime: staleTimeFor(range),
  });
}
