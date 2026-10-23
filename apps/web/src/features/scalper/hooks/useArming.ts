import type { InstrumentToken } from '@nthstock/contracts';
import { useCallback, useEffect, useState } from 'react';

/** Armed this long without a trade, the pad disarms (SPEC-TFC-1 §11.3). */
export const IDLE_DISARM_MS = 2 * 60 * 1000;

export type DisarmReason = 'idle' | 'hidden';

export type Arming = {
  readonly armed: boolean;
  setArmed: (on: boolean) => void;
  /** Call on every trade the pad sends: it restarts the idle timer. */
  noteTrade: () => void;
};

/**
 * The scalper's Arm switch (T22, SPEC-TFC-1 §11.3). Armed, the pad trades in one tap. It disarms
 * after two minutes without a trade, when the page is hidden, and when the pad moves to another
 * instrument. `onDisarm` hears the automatic
 * disarms, so the pad can say why.
 */
export function useArming(
  token: InstrumentToken,
  onDisarm?: (reason: DisarmReason) => void,
): Arming {
  const [state, setState] = useState<{ token: InstrumentToken; armed: boolean; trades: number }>(
    () => ({ token, armed: false, trades: 0 }),
  );
  // Another instrument: disarm now, so coming back to this one does not re-arm it.
  if (state.token !== token) setState({ token, armed: false, trades: state.trades });
  const armed = state.token === token && state.armed;

  const disarm = useCallback(
    (reason: DisarmReason) => {
      setState((current) => ({ ...current, armed: false }));
      onDisarm?.(reason);
    },
    [onDisarm],
  );

  // Two minutes after arming or the last trade.
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => disarm('idle'), IDLE_DISARM_MS);
    return () => clearTimeout(timer);
  }, [armed, state.trades, disarm]);

  // Another tab in front, the phone locked or the app switched away.
  useEffect(() => {
    if (!armed) return undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') disarm('hidden');
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [armed, disarm]);

  const setArmed = useCallback(
    (on: boolean) => setState((current) => ({ token, armed: on, trades: current.trades })),
    [token],
  );
  const noteTrade = useCallback(
    () => setState((current) => ({ ...current, trades: current.trades + 1 })),
    [],
  );
  return { armed, setArmed, noteTrade };
}
