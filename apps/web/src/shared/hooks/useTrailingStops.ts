import type { TradingState } from '@nthstock/apiClient';
import type { ProductType, TrailingStop } from '@nthstock/contracts';
import { useCallback } from 'react';
import { sameStops } from '@/shared/lib/trailingStopView';
import { useTradingSelector } from './useTradingSelector';

const allStops = (state: TradingState) => state.trailingStops;
const sameStop = (a: TrailingStop | null, b: TrailingStop | null) =>
  a === b || (a !== null && b !== null && a.id === b.id && a.seq === b.seq);

/** Today's trailing stops from the trading store, newest first; empty while it is idle. */
export function useTrailingStops(): readonly TrailingStop[] {
  return useTradingSelector(allStops, sameStops);
}

/**
 * The trailing stop of one position (token and product): its newest stop today, so a terminal one
 * stays visible after it ends (SPEC-TFC-1 §6.2). Null when it never had one.
 */
export function usePositionTrailingStop(token: number, product: ProductType): TrailingStop | null {
  const select = useCallback(
    (state: TradingState) =>
      state.trailingStops.find((stop) => stop.token === token && stop.product === product) ?? null,
    [token, product],
  );
  return useTradingSelector(select, sameStop);
}
