import type { Order } from '@nthstock/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { fundsKeys } from '@/features/funds';
import { holdingsKeys } from '@/features/holdings';
import { positionsKeys } from '@/features/positions';
import { useSession } from '@/shared/hooks/useSession';
import { claimFillToast } from '@/shared/lib/fillToasts';
import { useOrderUpdateSource } from '@/shared/lib/orderUpdatesContext';
import { ordersKeys } from '../api/ordersQuery';

/**
 * Live order updates (T-147). While a session is held it keeps the socket open and, on every
 * `orderUpdate`, refetches the order book, positions, holdings and funds (so a limit fill moves
 * its row to Executed without a reload), then calls `onFill` for a fill nobody has toasted yet
 * (the order ticket may have, from its own response).
 */
export function useOrderUpdates(onFill: (order: Order) => void): void {
  const source = useOrderUpdateSource();
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
      for (const queryKey of [ordersKeys.all, positionsKeys.all, holdingsKeys.all, fundsKeys.all]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      if (order.status === 'EXECUTED' && claimFillToast(order.id)) fill.current(order);
    });
  }, [status, source, queryClient]);
}
