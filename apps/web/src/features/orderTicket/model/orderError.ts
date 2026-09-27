import { isApiError } from '@nthstock/apiClient';
import { Order } from '@nthstock/contracts';
import { strings } from '../strings';

/** A refused or failed order, as the ticket shows it inline above the button. */
export type TicketError = {
  title: string;
  message: string;
  /** The stored REJECTED order, when the server kept one (422). */
  rejected?: Order;
};

const REJECTION_TITLES = {
  INSUFFICIENT_FUNDS: strings.errors.INSUFFICIENT_FUNDS,
  INSUFFICIENT_HOLDINGS: strings.errors.INSUFFICIENT_HOLDINGS,
  MARKET_CLOSED: strings.errors.MARKET_CLOSED,
  ORDER_REJECTED: strings.errors.ORDER_REJECTED,
} as const;

const isRejectionCode = (code: string): code is keyof typeof REJECTION_TITLES =>
  code in REJECTION_TITLES;

/**
 * Turns a failed `POST /v1/orders` (or, with `action` 'modify', `PATCH /v1/orders/:id`) into ticket copy (ADR 0005: titles from strings.ts). A 422 is
 * a risk-check rejection: the server stored the order as REJECTED and its reason is written for
 * people (the paper engine's plain-language reason), so it is shown as is. Everything else gets
 * this feature's own copy.
 */
export function describeOrderError(
  error: unknown,
  action: 'place' | 'modify' = 'place',
): TicketError {
  const title = action === 'modify' ? strings.modify.failedTitle : strings.errors.title;
  const generic = action === 'modify' ? strings.errors.modifyGeneric : strings.errors.generic;
  if (!isApiError(error)) return { title, message: generic };
  if (error.kind === 'network') {
    return { title, message: strings.errors.network };
  }
  if (error.status === 422 && isRejectionCode(error.code)) {
    const parsed = Order.safeParse(error.details?.order);
    const rejected = parsed.success ? parsed.data : undefined;
    const stored = rejected?.status === 'REJECTED' ? rejected : undefined;
    return {
      title: REJECTION_TITLES[error.code],
      message: stored?.statusReason ?? (error.message || strings.errors.rejectedFallback),
      ...(stored ? { rejected: stored } : {}),
    };
  }
  // A modify or cancel the order's state no longer allows (it filled or was cancelled): the
  // engine's reason is written for people.
  if (error.status === 409 && error.message) return { title, message: error.message };
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return { title: strings.errors.invalid, message: error.message };
    case 'NOT_FOUND':
      return {
        title,
        message: action === 'modify' ? strings.modify.gone : strings.errors.notFound,
      };
    case 'UNAUTHORIZED':
      return { title, message: strings.errors.sessionEnded };
    case 'RATE_LIMITED':
      return { title, message: strings.errors.rateLimited };
    default:
      return { title, message: generic };
  }
}
