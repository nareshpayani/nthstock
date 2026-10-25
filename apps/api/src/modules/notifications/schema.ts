import type { Exchange, Notification, NotificationKind, PriceAlert } from '@nthstock/contracts';

/**
 * A notification to store (spec market-data-and-matching §6.1, NSTOCK-0379). `refId` names what
 * raised it: an order, a trailing stop, an alert or a session. Title and body are built from
 * contract types only and never hold a mobile number or a name.
 */
export type NewNotification = {
  userId: string;
  kind: NotificationKind;
  refId: string | null;
  title: string;
  body: string;
  symbol: string | null;
  exchange: Exchange | null;
  /** The alert that fired, sent with the notification but not stored with it. */
  alert?: PriceAlert;
};

/** A stored notification and whose it is, as published on `notifyChannel(userId)`. */
export type StoredNotification = {
  userId: string;
  notification: Notification;
  alert?: PriceAlert;
};
