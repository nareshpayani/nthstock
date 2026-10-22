import type { PendingOrderPrice } from '@/shared/hooks/usePendingOrderPrices';
import { pendingPriceText } from '@/shared/lib/pendingPriceView';

/**
 * "Moving to ₹1,520.00" while an order line is dragged on the chart, "Updating to …" once the
 * modify is sent (T16, TFC-21). The same words on every surface that shows the order; nothing
 * when the order is not moving.
 */
export function PendingPrice({ pending }: { pending: PendingOrderPrice | undefined }) {
  if (!pending) return null;
  return (
    <span
      className="block text-label font-medium whitespace-nowrap text-brand"
      data-testid="pending-price"
      data-phase={pending.phase}
    >
      {pendingPriceText(pending)}
    </span>
  );
}
