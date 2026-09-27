import type { OrderSide, OrderStatus } from '@nthstock/contracts';
import { cn } from '@nthstock/ui';
import { strings } from '../strings';

const statusTone: Record<OrderStatus, string> = {
  AMO: 'bg-marigold-soft text-ink',
  OPEN: 'bg-brand-soft text-brand',
  EXECUTED: 'bg-up-soft text-up',
  CANCELLED: 'bg-canvas text-ink-muted',
  REJECTED: 'bg-down-soft text-down',
};

/** The order's status as a word on a tint: the word carries the meaning, not the colour. */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-sm px-1.5 py-0.5 text-label font-semibold whitespace-nowrap',
        statusTone[status],
      )}
    >
      {strings.statuses[status]}
    </span>
  );
}

/** "Buy" or "Sell" in its colour: the word carries the meaning, not the colour. */
export function OrderSideLabel({ side }: { side: OrderSide }) {
  return (
    <span className={cn('font-semibold', side === 'BUY' ? 'text-up' : 'text-down')}>
      {strings.sides[side]}
    </span>
  );
}
