import type { TradingState } from '@nthstock/apiClient';
import type { TrailingStop, TrailingStopStatus } from '@nthstock/contracts';
import { useToast, type ToastTone } from '@nthstock/ui';
import { formatInr } from '@nthstock/utils';
import { useEffect } from 'react';
import { useTradingStore } from '@/shared/lib/tradingStoreContext';

export type StopAnnouncement = { title: string; description: string; tone: ToastTone };

export const STOP_ANNOUNCEMENTS = {
  triggered: 'Trailing stop triggered',
  triggeredDescription: (qty: number, symbol: string, stop: string) =>
    `Exiting ${String(qty)} ${symbol} at market. The stop was ${stop}.`,
  cancelled: 'Trailing stop cancelled',
  cancelledDescription: (symbol: string, reason: string) => `${symbol}: ${reason}`,
  failed: 'Trailing stop exit failed',
  failedDescription: (symbol: string, reason: string) =>
    `${symbol}: ${reason}. Your position is still open.`,
} as const;

const LIVE: ReadonlySet<TrailingStopStatus> = new Set([
  'PENDING_ENTRY',
  'ARMED',
  'TRAILING',
  'TRIGGERED',
]);

/**
 * What to say when the engine moves a trailing stop on its own (SPEC-TFC-1 §13): a trigger and a
 * cancellation the user did not ask for (the position closed, the day ended) are polite; a failed
 * exit is an alert. The exit's fill is announced as an order fill, and the user's own Set,
 * Update and Cancel are answered by the sheet, so neither is repeated here.
 */
export function stopAnnouncement(
  before: TrailingStopStatus | undefined,
  stop: TrailingStop,
  cancelledByUser: boolean,
): StopAnnouncement | null {
  if (before === stop.status) return null;
  if (stop.status === 'TRIGGERED') {
    return {
      title: STOP_ANNOUNCEMENTS.triggered,
      description: STOP_ANNOUNCEMENTS.triggeredDescription(
        stop.protectedQty,
        stop.symbol,
        formatInr(stop.stopPrice ?? 0),
      ),
      tone: 'info',
    };
  }
  if (stop.status === 'REJECTED') {
    return {
      title: STOP_ANNOUNCEMENTS.failed,
      description: STOP_ANNOUNCEMENTS.failedDescription(
        stop.symbol,
        stop.statusReason ?? 'the exit was not accepted',
      ),
      tone: 'error',
    };
  }
  if (stop.status === 'CANCELLED' && before !== undefined && LIVE.has(before) && !cancelledByUser) {
    return {
      title: STOP_ANNOUNCEMENTS.cancelled,
      description: STOP_ANNOUNCEMENTS.cancelledDescription(
        stop.symbol,
        stop.statusReason ?? 'cancelled',
      ),
      tone: 'info',
    };
  }
  return null;
}

/**
 * Mounted once in the app shell (T24): watches the trading store's trailing stops and announces
 * what the engine does with them through toasts, which are polite live regions, or assertive for
 * an error. Stops already on the account when it loads are not announced.
 */
export function TrailingStopAnnouncer() {
  const store = useTradingStore();
  const toast = useToast();
  useEffect(() => {
    const seen = new Map<string, TrailingStopStatus>();
    const userCancels = new Set<string>();
    let loaded = false;
    const check = (state: TradingState) => {
      for (const intent of state.pending) {
        if (intent.kind === 'cancelTrailingStop' && intent.trailingStopId) {
          userCancels.add(intent.trailingStopId);
        }
      }
      if (state.status !== 'ready') return;
      for (const stop of state.trailingStops) {
        const before = seen.get(stop.id);
        seen.set(stop.id, stop.status);
        if (!loaded) continue;
        const said = stopAnnouncement(before, stop, userCancels.has(stop.id));
        if (said) toast.show(said);
      }
      loaded = true;
    };
    check(store.getState());
    return store.subscribe(() => check(store.getState()));
  }, [store, toast]);
  return null;
}
