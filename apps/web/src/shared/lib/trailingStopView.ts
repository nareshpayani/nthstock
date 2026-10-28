import type { TrailingStop, TrailingStopStatus } from '@nthstock/contracts';
import { formatInr } from '@nthstock/utils';

/** The status word every surface shows for a trailing stop (SPEC-TFC-1 §6.2). */
export const TRAILING_STOP_STATUS_WORDS: Record<TrailingStopStatus, string> = {
  PENDING_ENTRY: 'Waiting for entry',
  ARMED: 'Armed',
  TRAILING: 'Trailing',
  TRIGGERED: 'Triggered',
  EXECUTED: 'Exited',
  CANCELLED: 'Cancelled',
  REJECTED: 'Exit failed',
};

export const TRAILING_STOP_NAME = 'Trailing stop';

/** Statuses that show the stop price beside the word (§6.2). */
const SHOWS_STOP: ReadonlySet<TrailingStopStatus> = new Set(['TRAILING', 'TRIGGERED']);

/**
 * How a trailing stop reads on a row: the status word, the stop price while it trails or has
 * triggered, and the reason for a cancelled or failed one. "Trailing · stop ₹1,480.00".
 */
export function trailingStopSummary(
  stop: Pick<TrailingStop, 'status' | 'stopPrice' | 'statusReason'>,
): string {
  const word = TRAILING_STOP_STATUS_WORDS[stop.status];
  if (SHOWS_STOP.has(stop.status) && stop.stopPrice !== null) {
    return `${word} · stop ${formatInr(stop.stopPrice)}`;
  }
  if ((stop.status === 'CANCELLED' || stop.status === 'REJECTED') && stop.statusReason) {
    return `${word}: ${stop.statusReason}`;
  }
  return word;
}

/** Equal lists of the same stops at the same `seq`: a selector's `isEqual` for stop lists. */
export function sameStops(a: readonly TrailingStop[], b: readonly TrailingStop[]): boolean {
  return (
    a.length === b.length && a.every((stop, i) => stop.id === b[i]?.id && stop.seq === b[i].seq)
  );
}
