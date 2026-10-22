import { formatInr } from '@nthstock/utils';
import type { PendingOrderPrice } from '@/shared/hooks/usePendingOrderPrices';

/** How every surface words an order's pending price (T16, TFC-21), so they read the same. */
export const PENDING_PRICE_WORDS = { dragging: 'Moving to', sending: 'Updating to' } as const;

export const pendingPriceText = ({ price, phase }: PendingOrderPrice): string =>
  `${PENDING_PRICE_WORDS[phase]} ${formatInr(price)}`;
