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
export const positionLineId = (product: string) => `position:${product}`;
export const stopLineId = (id: string) => `stop:${id}`;

const trailWords = (stop: TrailingStop) =>
  stop.trail.unit === 'AMOUNT'
    ? formatInr(stop.trail.amount)
    : `${(stop.trail.basisPoints / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;

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

/**
 * The trailing stop's line (§8.1): dashed amber at the stop, "Trailing SL ₹1,228.40 · 1.5% ·
 * Trailing". Only while it has a stop price (trailing or triggered); waiting and armed stops show
 * on the position chip instead. Tapping it opens the sheet; dragging it comes in T19.
 */
export function stopLine(stop: TrailingStop): OverlayLine | null {
  if (stop.stopPrice === null || (stop.status !== 'TRAILING' && stop.status !== 'TRIGGERED')) {
    return null;
  }
  const price = formatInr(stop.stopPrice);
  const status = TRAILING_STOP_STATUS_WORDS[stop.status];
  return {
    id: stopLineId(stop.id),
    price: stop.stopPrice,
    tone: 'trailing',
    label: strings.stop.label(TRAILING_STOP_NAME, price, trailWords(stop), status),
    description: strings.stop.description(price, trailWords(stop), status),
    draggable: false,
  };
}
