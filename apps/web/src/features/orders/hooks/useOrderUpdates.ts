import type { Order } from '@nthstock/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useSession } from '@/shared/hooks/useSession';
import { claimFillToast, fillEventKey } from '@/shared/lib/fillToasts';
import { useOrderUpdateSource } from '@/shared/lib/orderUpdatesContext';
import { fundsKeys, holdingsKeys, ordersKeys, positionsKeys } from '@/shared/lib/queryKeys';
import { useTradingStore } from '@/shared/lib/tradingStoreContext';
import { isPartlyFilled } from '../model/orderBook';

/**
 * Live order updates (T-147). While a session is held it keeps the socket open and, on every
 * `orderUpdate`, brings the order book, positions, holdings and funds up to date (so a limit fill
 * moves its row to Executed without a reload), then calls `onFill` for each fill event nobody has
 * toasted yet: every partial fill and the final one (T11). The order ticket may have toasted the
 * final fill from its own response.
 *
 * With the trading store running (T11, ADR 0012) the store writes the book, positions and funds
 * summary through in the same commit as the frame, so only what it does not hold is refetched:
 * holdings, the funds ledger and the order's status timeline. Without it, everything refetches.
 */
export function useOrderUpdates(onFill: (order: Order) => void): void {
  const source = useOrderUpdateSource();
  const store = useTradingStore();
  const queryClient = useQueryClient();
  const { status } = useSession();
  const fill = useRef(onFill);
  useEffect(() => {
    fill.current = onFill;
  }, [onFill]);

  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    source.connect();
    return source.onOrderUpdate((order) => {
      const queryKeys =
        store.getState().status !== 'ready'
          ? [ordersKeys.all, positionsKeys.all, holdingsKeys.all, fundsKeys.all]
          : [ordersKeys.history(order.id), holdingsKeys.all, fundsKeys.ledger()];
      for (const queryKey of queryKeys) void queryClient.invalidateQueries({ queryKey });
      const filled = order.status === 'EXECUTED' || isPartlyFilled(order);
      if (filled && claimFillToast(fillEventKey(order))) fill.current(order);
    });
  }, [status, source, store, queryClient]);
}
