import type { OrderHistoryEntry, OrderHistoryEvent } from '@nthstock/contracts';
import { formatInr, formatIstDate, formatIstTimeSeconds } from '@nthstock/utils';
import { strings } from '../strings';

/** One step of the status timeline (T-146), ready to show. */
export type TimelineStep = {
  event: OrderHistoryEvent;
  label: string;
  /** The UTC instant, for `<time dateTime>`. */
  at: string;
  /** "10:00:05 am" in IST. */
  time: string;
  /** "28 Sept 2026" in IST. */
  date: string;
  /** What the step did: the terms, the fill, or the reason. */
  detail: string;
  tone: 'neutral' | 'up' | 'down';
};

const priceText = (entry: Pick<OrderHistoryEntry, 'price'>) =>
  entry.price === null ? strings.atMarket : formatInr(entry.price);

function detailOf(entry: OrderHistoryEntry): string {
  switch (entry.event) {
    case 'EXECUTED':
      return strings.eventDetail.fill(entry.qty, formatInr(entry.fillPrice ?? entry.price ?? 0));
    case 'CANCELLED':
    case 'REJECTED':
      return entry.note ?? strings.statuses[entry.status];
    case 'PLACED':
      if (entry.status === 'REJECTED') return entry.note ?? strings.statuses.REJECTED;
      if (entry.status === 'AMO') return strings.eventDetail.amo;
      return strings.eventDetail.terms(entry.qty, priceText(entry));
    default:
      return strings.eventDetail.terms(entry.qty, priceText(entry));
  }
}

const toneOf = (entry: OrderHistoryEntry): TimelineStep['tone'] =>
  entry.status === 'EXECUTED' ? 'up' : entry.status === 'REJECTED' ? 'down' : 'neutral';

/** Every change of an order, oldest first, each with its IST time (T-146). */
export function orderTimeline(entries: readonly OrderHistoryEntry[]): TimelineStep[] {
  return entries.map((entry) => {
    const at = new Date(entry.at);
    const label =
      entry.event === 'PLACED' && entry.status === 'REJECTED'
        ? `${strings.events.PLACED} · ${strings.statuses.REJECTED}`
        : strings.events[entry.event];
    return {
      event: entry.event,
      label,
      at: entry.at,
      time: formatIstTimeSeconds(at),
      date: formatIstDate(at),
      detail: detailOf(entry),
      tone: toneOf(entry),
    };
  });
}
