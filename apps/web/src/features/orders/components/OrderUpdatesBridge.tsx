import type { Order } from '@nthstock/contracts';
import { useToast } from '@nthstock/ui';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, type MouseEvent } from 'react';
import { useOrderUpdates } from '../hooks/useOrderUpdates';
import { fillToast } from '../model/fillToast';
import { strings } from '../strings';

/**
 * Mounted once in the app shell: applies live order updates on every page and toasts each fill,
 * "Order executed" / "BUY 10 INFY @ ₹1,512.35", with a link to the order book (T-147).
 */
export function OrderUpdatesBridge() {
  const toast = useToast();
  const navigate = useNavigate();
  const onFill = useCallback(
    (order: Order) => {
      const message = fillToast(order);
      if (!message) return;
      const viewOrders = (event: MouseEvent<HTMLAnchorElement>) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        void navigate({ to: '/orders' });
      };
      toast.show({
        ...message,
        tone: 'success',
        action: {
          altText: strings.fill.viewOrdersAlt,
          element: (
            <a href="/orders" onClick={viewOrders}>
              {strings.fill.viewOrders}
            </a>
          ),
        },
      });
    },
    [toast, navigate],
  );
  useOrderUpdates(onFill);
  return null;
}
