import { TICK_SIZE_PAISE, type PriceAlertCondition } from '@nthstock/contracts';

/** Quick levels in the alert dialog, as percent moves from the LTP. */
export const ALERT_PRESETS = [-2, -1, 1, 2] as const;

/** The LTP moved by `pct` percent, on the 5-paise tick, away from the LTP. */
export function presetLevel(ltp: number, pct: number): number {
  const raw = ltp + Math.round((ltp * pct) / 100);
  const ticks = pct > 0 ? Math.ceil(raw / TICK_SIZE_PAISE) : Math.floor(raw / TICK_SIZE_PAISE);
  return Math.max(TICK_SIZE_PAISE, ticks * TICK_SIZE_PAISE);
}

/** Above the LTP is an ABOVE alert, below it BELOW; at the LTP there is no alert to set. */
export function conditionFor(price: number, ltp: number): PriceAlertCondition | null {
  if (price > ltp) return 'ABOVE';
  if (price < ltp) return 'BELOW';
  return null;
}
