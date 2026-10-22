import type { TradingState } from '@nthstock/apiClient';
import type { Position, TrailingStop } from '@nthstock/contracts';
import { useCallback } from 'react';
import { useTradingSelector } from '@/shared/hooks/useTradingSelector';
import { sameStops } from '@/shared/lib/trailingStopView';

const samePositions = (a: readonly Position[], b: readonly Position[]) =>
  a.length === b.length &&
  a.every(
    (position, i) =>
      position.product === b[i]?.product &&
      position.netQty === b[i].netQty &&
      position.avgBuyPrice === b[i].avgBuyPrice &&
      position.avgSellPrice === b[i].avgSellPrice &&
      position.realisedPnl === b[i].realisedPnl,
  );

/** The open positions in one instrument (one per product); none while the store is idle. */
export function useChartPositions(token: number): readonly Position[] {
  const select = useCallback(
    (state: TradingState) =>
      state.positions.filter((position) => position.token === token && position.netQty !== 0),
    [token],
  );
  return useTradingSelector(select, samePositions);
}

/** Today's trailing stops in one instrument, newest first. */
export function useChartTrailingStops(token: number): readonly TrailingStop[] {
  const select = useCallback(
    (state: TradingState) => state.trailingStops.filter((stop) => stop.token === token),
    [token],
  );
  return useTradingSelector(select, sameStops);
}
