import { useToast } from '@nthstock/ui';
import { useEffect } from 'react';
import { useTradingStore } from '@/shared/lib/tradingStoreContext';

export const INTENT_TIMEOUT_TOAST = {
  title: 'Still waiting for a reply',
  description: 'Your last action has not been confirmed. Your orders and positions were refreshed.',
} as const;

/**
 * Mounted once in the app shell: when an order or trailing-stop action goes 5 seconds without an
 * answer, the trading store re-reads the account and this tells the user (SPEC-TFC-1 §10.1).
 */
export function TradingIntentTimeouts() {
  const store = useTradingStore();
  const toast = useToast();
  useEffect(
    () =>
      store.onIntentTimeout(() => {
        toast.show({ ...INTENT_TIMEOUT_TOAST, tone: 'error' });
      }),
    [store, toast],
  );
  return null;
}
