import type { OrderSide } from '@nthstock/contracts';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { haptic } from './haptics';
import {
  orderSoundsEnabled,
  playOrderSound,
  setOrderSoundsEnabled,
  subscribeOrderSounds,
  type OrderSound,
} from './orderSounds';

/**
 * The "order placed" moment (A17): one call gives the haptic and the sound for an order outcome, so
 * the ticket, Scalper, the trailing-stop sheets, the chart and live fills all feel the same.
 * `cancelled` is felt but not heard: a cancel is not news worth a sound.
 */
export type OrderCue = OrderSound | 'cancelled';

export function orderCue(cue: OrderCue): void {
  haptic(cue === 'rejected' ? 'reject' : 'commit');
  if (cue !== 'cancelled') playOrderSound(cue);
}

/** The cue for a fill on `side`: rising for a buy, falling for a sell. */
export function fillCue(side: OrderSide): OrderSound {
  return side === 'BUY' ? 'filledBuy' : 'filledSell';
}

/** How long a confirm button shows its tick before the sheet closes, in ms. */
export const SUCCESS_HOLD_MS = 450;

/** The order-sounds setting, live across every switch on screen. */
export function useOrderSounds(): [enabled: boolean, setEnabled: (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribeOrderSounds, orderSoundsEnabled, () => true);
  return [enabled, setOrderSoundsEnabled];
}

/**
 * The tick's moment: `hold(then)` turns `done` on (the confirm button draws its tick) and runs
 * `then`, usually closing the sheet, `SUCCESS_HOLD_MS` later. Unmounting first cancels it.
 */
export function useSuccessHold(): [done: boolean, hold: (then: () => void) => void] {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const hold = useCallback((then: () => void) => {
    setDone(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(then, SUCCESS_HOLD_MS);
  }, []);
  return [done, hold];
}
