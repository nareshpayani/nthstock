import {
  NOTIFICATIONS_KEPT,
  PRICE_ALERTS_MAX_ACTIVE,
  type CreatePriceAlertRequest,
  type Exchange,
  type Notification,
  type NotificationKind,
  type NotificationsResponse,
  type PriceAlert,
  type Quote,
} from '@nthstock/contracts';
import { formatInr, type Clock } from '@nthstock/utils';
import type { DeskMarket } from './paperDesk.js';

/** The slice of the market the alert desk reads. */
export type AlertMarket = Pick<DeskMarket, 'getQuote' | 'subscribe'>;

export type AlertDeskOptions = {
  clock: Clock;
  market: AlertMarket;
  newId: () => string;
  /** Every new notification, with the alert that raised it: the backend pushes it to the user. */
  onNotification?: (userId: string, notification: Notification, alert?: PriceAlert) => void;
  /** After any change to a user's alerts or notifications (MSW saves a snapshot here). */
  onChange?: (userId: string) => void;
};

/** Why a create or cancel was refused, mapped to an API error by the backend. */
export type AlertActionResult =
  | { ok: true; alert: PriceAlert }
  | {
      ok: false;
      code: 'NOT_FOUND' | 'VALIDATION_ERROR' | 'LIMIT_REACHED' | 'INVALID_STATE';
      message: string;
    };

/** One user's book, as saved between page loads. */
export type AlertBook = { alerts: PriceAlert[]; notifications: Notification[] };

export const ALERT_DESK_SNAPSHOT_VERSION = 1;
export type AlertDeskSnapshot = {
  v: typeof ALERT_DESK_SNAPSHOT_VERSION;
  users: Record<string, AlertBook>;
};

/** Triggered and cancelled alerts kept for the list, newest first, after the active ones. */
const ENDED_KEPT = 20;

type Watch = { exchange: Exchange; symbol: string; stop: () => void };

/**
 * The notification text of a fired alert, the same wherever it fires (the mock, apps/api and the
 * matcher, NSTOCK-0383): "INFY crossed above ₹1,530.00", "Now ₹1,531.20 · the user's note".
 */
export function priceAlertNotice(
  alert: Pick<PriceAlert, 'symbol' | 'condition' | 'price' | 'note'>,
  ltp: number,
): { title: string; body: string } {
  const direction = alert.condition === 'ABOVE' ? 'above' : 'below';
  return {
    title: `${alert.symbol} crossed ${direction} ${formatInr(alert.price)}`,
    body: [`Now ${formatInr(ltp)}`, alert.note].filter(Boolean).join(' · '),
  };
}

/** Whether `ltp` fires the alert: at or past its level on its side. */
export const crossed = (alert: Pick<PriceAlert, 'condition' | 'price'>, ltp: number) =>
  alert.condition === 'ABOVE' ? ltp >= alert.price : ltp <= alert.price;

/**
 * Price alerts and the notification centre (NSTOCK-0344), beside the paper desk on the same
 * market, in both backends.
 *
 * - An alert watches one instrument. The desk subscribes to an instrument while any user has an
 *   active alert on it, and checks every tick: an ABOVE alert fires on the first LTP at or above
 *   its price, a BELOW alert at or below. A gap past the level fires too, with the LTP that
 *   crossed it. Each alert fires once.
 * - Setting an alert the price has already passed is refused, so an alert never fires on the tick
 *   it was set.
 * - Notifications come from fired alerts and from the backend (`notify`: fills and trailing
 *   stops). The newest `NOTIFICATIONS_KEPT` are kept per user, with a read flag.
 */
export class AlertDesk {
  readonly #options: AlertDeskOptions;
  readonly #books = new Map<string, AlertBook>();
  readonly #watches = new Map<number, Watch>();

  constructor(options: AlertDeskOptions) {
    this.#options = options;
  }

  alerts(userId: string): PriceAlert[] {
    const { alerts } = this.#book(userId);
    const active = alerts.filter((alert) => alert.status === 'ACTIVE');
    const ended = alerts.filter((alert) => alert.status !== 'ACTIVE').slice(0, ENDED_KEPT);
    return [...active, ...ended];
  }

  async create(userId: string, request: CreatePriceAlertRequest): Promise<AlertActionResult> {
    const book = this.#book(userId);
    if (book.alerts.filter((a) => a.status === 'ACTIVE').length >= PRICE_ALERTS_MAX_ACTIVE) {
      return {
        ok: false,
        code: 'LIMIT_REACHED',
        message: `You can have at most ${String(PRICE_ALERTS_MAX_ACTIVE)} active alerts`,
      };
    }
    const exchange = request.exchange ?? 'NSE';
    const quote = await this.#options.market.getQuote(request.symbol, exchange);
    if (!quote) return { ok: false, code: 'NOT_FOUND', message: `Symbol ${request.symbol}` };
    if (crossed(request, quote.ltp)) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message:
          request.condition === 'ABOVE'
            ? `Set a price above the current ${formatInr(quote.ltp)}`
            : `Set a price below the current ${formatInr(quote.ltp)}`,
      };
    }
    const note = request.note?.trim();
    const alert: PriceAlert = {
      id: this.#options.newId(),
      token: quote.token,
      symbol: quote.symbol,
      exchange: quote.exchange,
      condition: request.condition,
      price: request.price,
      note: note ? note : null,
      status: 'ACTIVE',
      createdAt: this.#now(),
      createdLtp: quote.ltp,
      triggeredAt: null,
      triggeredLtp: null,
    };
    book.alerts.unshift(alert);
    this.#watch(alert);
    this.#changed(userId);
    return { ok: true, alert };
  }

  cancel(userId: string, id: string): AlertActionResult {
    const book = this.#book(userId);
    const index = book.alerts.findIndex((alert) => alert.id === id);
    const alert = book.alerts[index];
    if (!alert) return { ok: false, code: 'NOT_FOUND', message: 'Alert not found' };
    if (alert.status !== 'ACTIVE') {
      return { ok: false, code: 'INVALID_STATE', message: 'This alert has already ended' };
    }
    const cancelled: PriceAlert = { ...alert, status: 'CANCELLED' };
    book.alerts[index] = cancelled;
    this.#unwatchIfIdle(alert.token);
    this.#changed(userId);
    return { ok: true, alert: cancelled };
  }

  notifications(userId: string): NotificationsResponse {
    const { notifications } = this.#book(userId);
    return { items: [...notifications], unread: notifications.filter((n) => !n.read).length };
  }

  markRead(userId: string, ids?: readonly string[]): NotificationsResponse {
    const book = this.#book(userId);
    const wanted = ids ? new Set(ids) : null;
    let changed = false;
    book.notifications = book.notifications.map((n) => {
      if (n.read || (wanted && !wanted.has(n.id))) return n;
      changed = true;
      return { ...n, read: true };
    });
    if (changed) this.#changed(userId);
    return this.notifications(userId);
  }

  /** Adds a notification from elsewhere in the backend (a fill, a trailing stop). */
  notify(
    userId: string,
    input: {
      kind: NotificationKind;
      title: string;
      body: string;
      symbol?: string;
      exchange?: Exchange;
    },
  ): Notification {
    return this.#add(userId, input);
  }

  /** Feeds one tick, as the market subscription does; exported for scripted ticks in tests. */
  onQuotes(quotes: readonly Quote[]): void {
    for (const quote of quotes) {
      for (const [userId, book] of this.#books) {
        let fired = false;
        book.alerts = book.alerts.map((alert) => {
          if (alert.status !== 'ACTIVE' || alert.token !== quote.token) return alert;
          if (!crossed(alert, quote.ltp)) return alert;
          fired = true;
          const triggered: PriceAlert = {
            ...alert,
            status: 'TRIGGERED',
            triggeredAt: this.#now(),
            triggeredLtp: quote.ltp,
          };
          this.#add(
            userId,
            {
              kind: 'PRICE_ALERT',
              ...priceAlertNotice(alert, quote.ltp),
              symbol: alert.symbol,
              exchange: alert.exchange,
            },
            triggered,
          );
          return triggered;
        });
        if (fired) this.#changed(userId);
      }
      this.#unwatchIfIdle(quote.token);
    }
  }

  snapshot(): AlertDeskSnapshot {
    const users: Record<string, AlertBook> = {};
    for (const [userId, book] of this.#books) {
      users[userId] = { alerts: [...book.alerts], notifications: [...book.notifications] };
    }
    return { v: ALERT_DESK_SNAPSHOT_VERSION, users };
  }

  /** Loads a saved desk and watches every active alert again. */
  restore(snapshot: AlertDeskSnapshot): void {
    for (const [userId, book] of Object.entries(snapshot.users)) {
      this.#books.set(userId, { alerts: [...book.alerts], notifications: [...book.notifications] });
      for (const alert of book.alerts) if (alert.status === 'ACTIVE') this.#watch(alert);
    }
  }

  /** Stops every market subscription (tests and shutdown). */
  close(): void {
    for (const watch of this.#watches.values()) watch.stop();
    this.#watches.clear();
  }

  #book(userId: string): AlertBook {
    let book = this.#books.get(userId);
    if (!book) {
      book = { alerts: [], notifications: [] };
      this.#books.set(userId, book);
    }
    return book;
  }

  #add(
    userId: string,
    input: {
      kind: NotificationKind;
      title: string;
      body: string;
      symbol?: string;
      exchange?: Exchange;
    },
    alert?: PriceAlert,
  ): Notification {
    const notification: Notification = {
      id: this.#options.newId(),
      kind: input.kind,
      title: input.title,
      body: input.body,
      symbol: input.symbol ?? null,
      exchange: input.exchange ?? null,
      at: this.#now(),
      read: false,
    };
    const book = this.#book(userId);
    book.notifications = [notification, ...book.notifications].slice(0, NOTIFICATIONS_KEPT);
    this.#changed(userId);
    this.#options.onNotification?.(userId, notification, alert);
    return notification;
  }

  #watch(alert: PriceAlert): void {
    if (this.#watches.has(alert.token)) return;
    const stop = this.#options.market.subscribe(
      [alert.symbol],
      (quotes) => {
        this.onQuotes(quotes);
      },
      alert.exchange,
    );
    this.#watches.set(alert.token, { exchange: alert.exchange, symbol: alert.symbol, stop });
  }

  #unwatchIfIdle(token: number): void {
    for (const book of this.#books.values()) {
      if (book.alerts.some((a) => a.token === token && a.status === 'ACTIVE')) return;
    }
    this.#watches.get(token)?.stop();
    this.#watches.delete(token);
  }

  #changed(userId: string): void {
    this.#options.onChange?.(userId);
  }

  #now(): string {
    return this.#options.clock.now().toISOString();
  }
}
