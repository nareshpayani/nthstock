import type { TrailingStop } from '@nthstock/contracts';
import { formatInr } from '@nthstock/utils';
import type { LivePosition } from '@/features/positions';
import { signedInr } from '@/shared/components/PnlAmount';
import {
  TRAILING_STOP_NAME,
  TRAILING_STOP_STATUS_WORDS,
  trailingStopSummary,
} from '@/shared/lib/trailingStopView';
import { strings } from '../strings';
import type { OverlayLine } from './overlayLine';

/** Line ids, so a tap knows what it hit. */
const positionLineId = (product: string) => `position:${product}`;
export const stopLineId = (id: string) => `stop:${id}`;

/** A trail in words: "1.5%" or "₹12.50". */
export const trailWords = (trail: TrailingStop['trail']) =>
  trail.unit === 'AMOUNT'
    ? formatInr(trail.amount)
    : `${(trail.basisPoints / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;

/**
 * The line for an open position (T18, SPEC-TFC-1 §8.1): at the average price, with a chip
 * "+10 @ ₹1,234.50 · +₹120.00" whose P&L follows the price. Not dragged; tapping it opens the
 * trailing-stop sheet, and a drag that starts on it pans the chart. Null without an average.
 */
export function positionLine(live: LivePosition, stop: TrailingStop | null): OverlayLine | null {
  if (live.avgPrice === null) return null;
  const { netQty } = live.position;
  const qty = netQty > 0 ? `+${String(netQty)}` : String(netQty);
  const avg = formatInr(live.avgPrice);
  const pnl = signedInr(live.pnl);
  return {
    id: positionLineId(live.position.product),
    price: live.avgPrice,
    tone: 'position',
    // A stop with no line yet (waiting for entry, or armed) shows its state on the chip (§8.1).
    label:
      stop && (stop.status === 'ARMED' || stop.status === 'PENDING_ENTRY')
        ? `${strings.position.label(qty, avg, pnl)} · ${TRAILING_STOP_NAME} ${TRAILING_STOP_STATUS_WORDS[stop.status].toLowerCase()}`
        : strings.position.label(qty, avg, pnl),
    description: strings.position.description(
      netQty > 0 ? strings.position.long : strings.position.short,
      Math.abs(netQty),
      avg,
      pnl,
      stop ? trailingStopSummary(stop) : null,
    ),
    draggable: false,
  };
}

/** A stop being moved on the chart: under the finger, or sent and waiting for the engine. */
export type PendingStop = { price: number; phase: 'dragging' | 'sending' };

/**
 * The trailing stop's line (§8.1): dashed amber at the stop, "Trailing stop ₹1,228.40 · 1.5% ·
 * Trailing". Only while it has a stop price (trailing or triggered); waiting and armed stops show
 * on the position chip instead. It rises as the stop ratchets. While trailing it can be dragged to
 * a new stop, which changes the trail (T19, §6.5): it follows the finger, then reads "Saving…"
 * until the engine answers. Tapping it opens the sheet.
 */
export function stopLine(stop: TrailingStop, pending?: PendingStop): OverlayLine | null {
  if (stop.stopPrice === null || (stop.status !== 'TRAILING' && stop.status !== 'TRIGGERED')) {
    return null;
  }
  const at = pending?.price ?? stop.stopPrice;
  const price = formatInr(at);
  const trail = trailWords(stop.trail);
  const status = TRAILING_STOP_STATUS_WORDS[stop.status];
  const sending = pending?.phase === 'sending';
  const draggable = stop.status === 'TRAILING' && !sending;
  return {
    id: stopLineId(stop.id),
    price: at,
    tone: sending ? 'pending' : 'trailing',
    label: sending
      ? strings.stop.updating(price)
      : strings.stop.label(TRAILING_STOP_NAME, price, trail, status),
    description: draggable
      ? strings.stop.dragDescription(price, trail)
      : strings.stop.description(price, trail, status),
    draggable,
  };
}

/** Line id for a stop's activation price. */
const activationLineId = (id: string) => `activation:${id}`;

/**
 * A stop waiting to start trailing draws its activation price as a thin dotted line (§8.1),
 * "Activates at ₹1,560.00". Tapping it opens the sheet.
 */
export function activationLine(stop: TrailingStop): OverlayLine | null {
  if (stop.activationPrice === null) return null;
  if (stop.status !== 'ARMED' && stop.status !== 'PENDING_ENTRY') return null;
  const price = formatInr(stop.activationPrice);
  return {
    id: activationLineId(stop.id),
    price: stop.activationPrice,
    tone: 'activation',
    label: strings.stop.activation(price),
    description: strings.stop.activationDescription(price),
    draggable: false,
  };
}

/**
 * Whether a stop at `stopPrice` would trigger at once (§6.6): at or above the LTP for a long, at
 * or below it for a short. The engine checks the same and says the same.
 */
export function stopTriggersNow(
  direction: TrailingStop['direction'],
  ltp: number | undefined,
  stopPrice: number,
): boolean {
  if (ltp === undefined) return false;
  return direction === 'LONG' ? stopPrice >= ltp : stopPrice <= ltp;
}
