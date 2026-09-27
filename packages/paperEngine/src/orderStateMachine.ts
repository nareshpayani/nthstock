import type { OrderStatus } from '@nthstock/contracts';

/**
 * What can happen to an order after it is stored.
 *
 * - `RELEASE`: an AMO goes to the exchange at the next session's 9:15 IST.
 * - `FILL`: the fill matcher fills the whole remaining quantity.
 * - `MODIFY`: qty, type or price change; the status stays the same.
 * - `CANCEL`: by the user, or by the engine at the 15:20 square-off (intraday) or 15:30 close.
 * - `REJECT`: an AMO fails validation again when it is released (price, cash or holdings moved).
 *
 * A new order that fails validation is stored straight as REJECTED; that is its initial status,
 * not a transition.
 */
export type OrderEvent = 'RELEASE' | 'FILL' | 'MODIFY' | 'CANCEL' | 'REJECT';

export const ORDER_EVENTS: readonly OrderEvent[] = [
  'RELEASE',
  'FILL',
  'MODIFY',
  'CANCEL',
  'REJECT',
];

/** AMO → OPEN → EXECUTED | CANCELLED; REJECTED on validation. Every pair not listed is illegal. */
export const ORDER_TRANSITIONS: Readonly<
  Record<OrderStatus, Readonly<Partial<Record<OrderEvent, OrderStatus>>>>
> = {
  AMO: { RELEASE: 'OPEN', MODIFY: 'AMO', CANCEL: 'CANCELLED', REJECT: 'REJECTED' },
  OPEN: { FILL: 'EXECUTED', MODIFY: 'OPEN', CANCEL: 'CANCELLED' },
  EXECUTED: {},
  CANCELLED: {},
  REJECTED: {},
};

/** Statuses an order can be stored with when it is placed. */
export const INITIAL_ORDER_STATUSES: readonly OrderStatus[] = ['AMO', 'OPEN', 'REJECTED'];

/** True once an order can no longer change. */
export function isTerminalStatus(status: OrderStatus): boolean {
  return Object.keys(ORDER_TRANSITIONS[status]).length === 0;
}

/** The status after `event`, or `null` when the event is illegal in `status`. */
export function nextOrderStatus(status: OrderStatus, event: OrderEvent): OrderStatus | null {
  return ORDER_TRANSITIONS[status][event] ?? null;
}

const STATUS_WORDS: Record<OrderStatus, string> = {
  AMO: 'waiting for the market to open',
  OPEN: 'open',
  EXECUTED: 'already executed',
  CANCELLED: 'already cancelled',
  REJECTED: 'rejected',
};

const EVENT_WORDS: Record<OrderEvent, string> = {
  RELEASE: 'sent to the exchange',
  FILL: 'filled',
  MODIFY: 'modified',
  CANCEL: 'cancelled',
  REJECT: 'rejected',
};

/** Thrown for an illegal transition; `message` is plain language. */
export class OrderTransitionError extends Error {
  readonly status: OrderStatus;
  readonly event: OrderEvent;

  constructor(status: OrderStatus, event: OrderEvent) {
    super(illegalTransitionReason(status, event));
    this.name = 'OrderTransitionError';
    this.status = status;
    this.event = event;
  }
}

/** "This order is already executed, so it can't be cancelled." */
export function illegalTransitionReason(status: OrderStatus, event: OrderEvent): string {
  return `This order is ${STATUS_WORDS[status]}, so it can't be ${EVENT_WORDS[event]}.`;
}

/** The status after `event`; throws `OrderTransitionError` when the event is illegal. */
export function transitionOrder(status: OrderStatus, event: OrderEvent): OrderStatus {
  const next = nextOrderStatus(status, event);
  if (next === null) throw new OrderTransitionError(status, event);
  return next;
}
