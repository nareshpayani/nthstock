import type { PositionDirection, TrailingStop } from '@nthstock/contracts';
import type { TicketFormValues } from './ticketForm';
import {
  attachedDirection,
  checkAttached,
  defaultTrailingValues,
  type TrailingCheck,
  type TrailingFormValues,
} from './trailingStopForm';

/** "Add trailing stop" on an entry (T14): whether it is on, its values, and whether to show errors. */
export type AttachState = {
  enabled: boolean;
  values: TrailingFormValues;
  /** Errors show once the user has typed a trail or tried to submit. */
  touched: boolean;
};

export const initialAttachState = (): AttachState => ({
  enabled: false,
  values: defaultTrailingValues('DELIVERY'),
  touched: false,
});

export type AttachPlan = {
  status: 'available' | 'unavailable' | 'notForSale';
  direction: PositionDirection | null;
  /** The price the entry is expected to fill at: the limit price, or the LTP for a market order. */
  refPrice: number | null;
  /** The §6.6 check; `{ ok: true }` when nothing is attached. */
  check: TrailingCheck;
  /** Whether the entry goes out with a trailing stop attached. */
  attaching: boolean;
};

/**
 * What "Add trailing stop" means for the ticket as it stands (T14, SPEC-TFC-1 §6.4, §7). It is
 * offered where the backend runs trailing stops, on a buy or an Intraday sell; the stop is checked
 * against the expected fill price.
 */
export function attachPlan(
  ticket: Pick<TicketFormValues, 'side' | 'type' | 'product' | 'price'>,
  attach: AttachState,
  context: { trailingAvailable: boolean; ltp: number | null },
): AttachPlan {
  const direction = attachedDirection(ticket.side, ticket.product);
  const status = !context.trailingAvailable
    ? 'unavailable'
    : direction === null
      ? 'notForSale'
      : 'available';
  const refPrice = ticket.type === 'LIMIT' ? ticket.price : context.ltp;
  const attaching = status === 'available' && attach.enabled && direction !== null;
  const check: TrailingCheck =
    attaching && direction !== null
      ? checkAttached({ ...attach.values, product: ticket.product }, { direction, refPrice })
      : { ok: true };
  return { status, direction, refPrice, check, attaching };
}

/**
 * Whether the entry adds to a position whose trailing stop it will replace (§6.4): an active stop
 * on the same product, protecting the same direction.
 */
export function replacesStop(
  activeStops: readonly Pick<TrailingStop, 'product' | 'direction'>[],
  ticket: Pick<TicketFormValues, 'product'>,
  direction: PositionDirection | null,
): boolean {
  return (
    direction !== null &&
    activeStops.some((stop) => stop.product === ticket.product && stop.direction === direction)
  );
}
