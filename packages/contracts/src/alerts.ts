import { z } from 'zod';
import {
  Exchange,
  Id,
  InstrumentToken,
  IsoUtc,
  NonNegativePaise,
  TickPrice,
  TradingSymbol,
} from './primitives.js';

/**
 * Price alerts and the notification centre (NSTOCK-0344). An alert watches one instrument's LTP and
 * fires once when the price crosses its level; firing, a fill and a trailing stop triggering each
 * add a notification the user reads in the centre and sees as a toast.
 */

/** ABOVE fires when the LTP reaches or rises past the price, BELOW when it reaches or falls past. */
export const PriceAlertCondition = z.enum(['ABOVE', 'BELOW']);
export type PriceAlertCondition = z.infer<typeof PriceAlertCondition>;

/** ACTIVE → TRIGGERED, or CANCELLED by the user. TRIGGERED and CANCELLED are terminal. */
export const PriceAlertStatus = z.enum(['ACTIVE', 'TRIGGERED', 'CANCELLED']);
export type PriceAlertStatus = z.infer<typeof PriceAlertStatus>;

/** At most this many active alerts per user, as brokers cap them. */
export const PRICE_ALERTS_MAX_ACTIVE = 50;

export const PriceAlert = z.object({
  id: Id,
  token: InstrumentToken,
  symbol: TradingSymbol,
  exchange: Exchange,
  condition: PriceAlertCondition,
  price: TickPrice,
  /** Optional reminder the user typed, shown in the notification. */
  note: z.string().max(80).nullable(),
  status: PriceAlertStatus,
  createdAt: IsoUtc,
  /** The LTP when the alert was set: tells the chart which side of the line the price started. */
  createdLtp: NonNegativePaise,
  triggeredAt: IsoUtc.nullable(),
  /** The LTP that fired it, which can be past the level on a gap. */
  triggeredLtp: NonNegativePaise.nullable(),
});
export type PriceAlert = z.infer<typeof PriceAlert>;

export const CreatePriceAlertRequest = z.object({
  symbol: TradingSymbol,
  exchange: Exchange.default('NSE'),
  condition: PriceAlertCondition,
  price: TickPrice,
  note: z.string().trim().max(80).optional(),
});
export type CreatePriceAlertRequest = z.input<typeof CreatePriceAlertRequest>;

export const PriceAlertIdParams = z.object({ id: Id });
export type PriceAlertIdParams = z.infer<typeof PriceAlertIdParams>;

/** Newest first: active alerts, then the latest triggered and cancelled ones. */
export const PriceAlertsResponse = z.object({ items: z.array(PriceAlert) });
export type PriceAlertsResponse = z.infer<typeof PriceAlertsResponse>;

/** What raised a notification. */
export const NotificationKind = z.enum(['PRICE_ALERT', 'ORDER_FILLED', 'TRAILING_STOP']);
export type NotificationKind = z.infer<typeof NotificationKind>;

/** The centre keeps the newest this many per user. */
export const NOTIFICATIONS_KEPT = 100;

export const Notification = z.object({
  id: Id,
  kind: NotificationKind,
  /** "INFY crossed above ₹1,530.00" */
  title: z.string().min(1).max(120),
  /** "Now ₹1,531.20 · Your note" */
  body: z.string().max(200),
  symbol: TradingSymbol.nullable(),
  exchange: Exchange.nullable(),
  at: IsoUtc,
  read: z.boolean(),
});
export type Notification = z.infer<typeof Notification>;

/** Newest first, with the unread count so the bell needs no second call. */
export const NotificationsResponse = z.object({
  items: z.array(Notification),
  unread: z.number().int().min(0),
});
export type NotificationsResponse = z.infer<typeof NotificationsResponse>;

/** Marks the given notifications read, or all of them when `ids` is left out. */
export const MarkNotificationsReadRequest = z.object({
  ids: z.array(Id).min(1).max(NOTIFICATIONS_KEPT).optional(),
});
export type MarkNotificationsReadRequest = z.infer<typeof MarkNotificationsReadRequest>;
