import { useToast } from '@nthstock/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { fundsKeys } from '@/features/funds';
import { holdingsKeys } from '@/features/holdings';
import { positionsKeys } from '@/features/positions';
import { useSession } from '@/shared/hooks/useSession';
import { claimFillToast } from '@/shared/lib/fillToasts';
import { useOrderUpdateSource } from '@/shared/lib/orderUpdatesContext';
import { ordersKeys } from '../api/ordersQuery';
import { fillToast } from '../model/fillToast';

/**
 * Live order updates (T-147). While a session is held it keeps the socket open and, on every
 * `orderUpdate`, refetches the order book, positions, holdings and funds (so a limit fill moves
 * its row to Executed without a reload) and toasts a fill: "Order executed" / "BUY 10 INFY @
 * ₹1,512.35". A fill the order ticket already toasted is not toasted twice.
 */
export function useOrderUpdates(): void {
  const source = useOrderUpdateSource();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { status } = useSession();

  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    source.connect();
    return source.onOrderUpdate((order) => {
      for (const queryKey of [ordersKeys.all, positionsKeys.all, holdingsKeys.all, fundsKeys.all]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      const message = fillToast(order);
      if (message && claimFillToast(order.id)) {
        toast.show({ ...message, tone: 'success' });
      }
    });
  }, [status, source, queryClient, toast]);
}
