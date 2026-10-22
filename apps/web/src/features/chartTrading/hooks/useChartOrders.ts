import type { TradingState } from '@nthstock/apiClient';
import type { Order } from '@nthstock/contracts';
import { useCallback } from 'react';
import { useTradingSelector } from '@/shared/hooks/useTradingSelector';
import { isWorkingLimit } from '../model/orderLines';

export type WorkingLimit = Order & { price: number };

const sameOrders = (a: readonly WorkingLimit[], b: readonly WorkingLimit[]) =>
  a.length === b.length && a.every((order, i) => order.id === b[i]?.id && order.seq === b[i].seq);

/** The working limit orders in one instrument, from the trading store; none while it is idle. */
export function useChartOrders(token: number): readonly WorkingLimit[] {
  const select = useCallback(
    (state: TradingState) =>
      state.orders.filter(
        (order): order is WorkingLimit => order.token === token && isWorkingLimit(order),
      ),
    [token],
  );
  return useTradingSelector(select, sameOrders);
}
