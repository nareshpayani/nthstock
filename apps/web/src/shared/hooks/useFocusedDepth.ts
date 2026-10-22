import type { TradingState } from '@nthstock/apiClient';
import type { Depth, Exchange } from '@nthstock/contracts';
import { useCallback, useEffect } from 'react';
import { useTradingStore } from '@/shared/lib/tradingStoreContext';
import { useTradingSelector } from './useTradingSelector';

const isActive = (state: TradingState) => state.status !== 'idle';

/**
 * The instrument on screen (T11, ADR 0012): focuses it in the trading store while mounted, so each
 * `accountDelta` frame carries its depth, and returns that depth, committed in the same frame as
 * the tick and any fill. Null while the store is idle (api mode, signed out) or before the first
 * frame; the caller falls back to `GET /v1/depth`.
 */
export function useFocusedDepth(symbol: string, exchange: Exchange): Depth | null {
  const store = useTradingStore();
  const active = useTradingSelector(isActive);
  useEffect(() => {
    if (!active) return undefined;
    store.focus(symbol, exchange);
    return () => {
      const { focus } = store.getState();
      if (focus?.symbol === symbol && focus.exchange === exchange) store.focus(null);
    };
  }, [active, store, symbol, exchange]);
  const select = useCallback(
    ({ depth }: TradingState) =>
      depth && depth.symbol === symbol && depth.exchange === exchange ? depth : null,
    [symbol, exchange],
  );
  return useTradingSelector(select);
}
