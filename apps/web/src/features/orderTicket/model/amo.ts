import { formatIstDate, nextSessionOpen, type Clock } from '@nthstock/utils';

/**
 * The IST date an after-market order goes to the exchange (T-138): the next 9:15 AM session open
 * on a trading day, weekends and NSE holidays skipped, e.g. "28 Sept 2026".
 */
export function amoDate(clock: Clock): string {
  return formatIstDate(nextSessionOpen(clock));
}
