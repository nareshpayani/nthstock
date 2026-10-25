import { randomUUID } from 'node:crypto';
import {
  MATCHER_COMMAND_VERSION,
  PRICE_ALERTS_MAX_ACTIVE,
  type CreatePriceAlertRequest,
  type MatcherCommand,
  type NotificationsResponse,
  type PriceAlert,
  type Quote,
} from '@nthstock/contracts';
import type { MarketDataAdapter } from '@nthstock/marketData';
import { priceAlertCrossed, priceAlertNotice } from '@nthstock/paperEngine';
import { formatInr, type Clock } from '@nthstock/utils';
import { ApiHttpError } from '../../http/apiError.js';
import type { NewNotification, Notifier } from '../notifications/index.js';
import type { ActiveAlert, AlertsRepo } from './repo.js';

export type AlertServiceOptions = {
  clock: Clock;
  market: Pick<MarketDataAdapter, 'getQuote' | 'subscribe'>;
  /** Where alerts are stored (NSTOCK-0383); firing writes the notification with the alert. */
  repo: AlertsRepo;
  /** The notification centre: fired alerts are announced through it once stored. */
  notifier: Notifier;
  /**
   * Sends an alert's `ALERT_ADD` or `ALERT_CANCEL` to the matcher of its shard, when there is one
   * (the quote service runs). The matcher then fires it on its book too; the store keeps it to one.
   */
  sendCommand?: (command: MatcherCommand) => void;
  /**
   * Reports a fired alert that could not be stored (it stays ACTIVE, so the next crossing tick
   * fires it again); apps/api logs it with the user and alert ids.
   */
  onNotifyError: (error: unknown, context: { userId: string; alertId: string | null }) => void;
  newId?: () => string;
};

/** The notification a fired alert raises, with the same text as the mock. */
export const alertNotification = ({ userId, alert }: ActiveAlert): NewNotification => ({
  userId,
  kind: 'PRICE_ALERT',
  refId: alert.id,
  ...priceAlertNotice(alert, alert.triggeredLtp ?? alert.price),
  symbol: alert.symbol,
  exchange: alert.exchange,
});

type Watch = { stop: () => void; alerts: Map<string, ActiveAlert> };

/**
 * Price alerts (NSTOCK-0344) on the alerts store (NSTOCK-0383), and the notification centre on
 * the notifications store (NSTOCK-0379).
 *
 * - Create refuses a level the price has already passed and past `PRICE_ALERTS_MAX_ACTIVE`, as
 *   the mock does; cancel ends an ACTIVE alert.
 * - This process watches every active alert's instrument (loaded at `ready`) and fires an alert on
 *   the first tick at or past its level through `repo.fire`, which stores it as TRIGGERED with its
 *   notification in one transaction. With the matcher running, each alert is also on its book;
 *   whichever sees the tick first stores it, and the other's `fire` finds it no longer ACTIVE.
 */
export function createAlertService({
  clock,
  market,
  repo,
  notifier,
  sendCommand,
  onNotifyError,
  newId = () => `al_${randomUUID().replaceAll('-', '')}`,
}: AlertServiceOptions) {
  const watches = new Map<number, Watch>();
  let closed = false;

  const unwatch = (token: number, alertId: string) => {
    const watch = watches.get(token);
    if (!watch) return;
    watch.alerts.delete(alertId);
    if (watch.alerts.size > 0) return;
    watch.stop();
    watches.delete(token);
  };

  const fire = (active: ActiveAlert, ltp: number) => {
    unwatch(active.alert.token, active.alert.id);
    repo
      .fire(active.alert.id, ltp, clock.now(), alertNotification)
      .then((fired) => {
        if (fired) notifier.committed([fired.stored]);
      })
      .catch((error: unknown) => {
        onNotifyError(error, { userId: active.userId, alertId: active.alert.id });
        // Still ACTIVE in the store: watch it again so the next crossing tick retries.
        if (!closed) watch(active);
      });
  };

  const onQuotes = (quotes: readonly Quote[]) => {
    for (const quote of quotes) {
      const watch = watches.get(quote.token);
      if (!watch) continue;
      for (const active of [...watch.alerts.values()]) {
        if (priceAlertCrossed(active.alert, quote.ltp)) fire(active, quote.ltp);
      }
    }
  };

  function watch(active: ActiveAlert) {
    const { alert } = active;
    let found = watches.get(alert.token);
    if (!found) {
      const stop = market.subscribe([alert.symbol], onQuotes, alert.exchange);
      found = { stop, alerts: new Map() };
      watches.set(alert.token, found);
    }
    found.alerts.set(alert.id, active);
  }

  const command = (alert: PriceAlert, userId: string, cancel: boolean): MatcherCommand => {
    const base = { v: MATCHER_COMMAND_VERSION, token: alert.token, version: 0 } as const;
    return cancel
      ? { ...base, type: 'ALERT_CANCEL', alertId: alert.id }
      : {
          ...base,
          type: 'ALERT_ADD',
          alertId: alert.id,
          userId,
          condition: alert.condition,
          price: alert.price,
        };
  };

  return {
    /** Loads and watches every active alert (boot). */
    async ready() {
      for (const active of await repo.active()) watch(active);
    },

    list: async (userId: string) => ({ items: await repo.list(userId) }),

    async create(userId: string, request: CreatePriceAlertRequest): Promise<PriceAlert> {
      if ((await repo.countActive(userId)) >= PRICE_ALERTS_MAX_ACTIVE) {
        throw new ApiHttpError(
          422,
          'LIMIT_REACHED',
          `You can have at most ${String(PRICE_ALERTS_MAX_ACTIVE)} active alerts`,
        );
      }
      const exchange = request.exchange ?? 'NSE';
      const quote = await market.getQuote(request.symbol, exchange);
      if (!quote) throw new ApiHttpError(404, 'NOT_FOUND', `Symbol ${request.symbol}`);
      if (priceAlertCrossed(request, quote.ltp)) {
        throw new ApiHttpError(
          400,
          'VALIDATION_ERROR',
          request.condition === 'ABOVE'
            ? `Set a price above the current ${formatInr(quote.ltp)}`
            : `Set a price below the current ${formatInr(quote.ltp)}`,
        );
      }
      const note = request.note?.trim();
      const alert: PriceAlert = {
        id: newId(),
        token: quote.token,
        symbol: quote.symbol,
        exchange: quote.exchange,
        condition: request.condition,
        price: request.price,
        note: note ? note : null,
        status: 'ACTIVE',
        createdAt: clock.now().toISOString(),
        createdLtp: quote.ltp,
        triggeredAt: null,
        triggeredLtp: null,
      };
      await repo.insert(userId, alert);
      watch({ userId, alert });
      sendCommand?.(command(alert, userId, false));
      return alert;
    },

    async cancel(userId: string, id: string): Promise<PriceAlert> {
      const result = await repo.cancel(userId, id);
      if (result === 'NOT_FOUND') throw new ApiHttpError(404, 'NOT_FOUND', 'Alert not found');
      if (result === 'INVALID_STATE') {
        throw new ApiHttpError(409, 'CONFLICT', 'This alert has already ended');
      }
      unwatch(result.token, result.id);
      sendCommand?.(command(result, userId, true));
      return result;
    },

    notifications: (userId: string): Promise<NotificationsResponse> => notifier.repo.list(userId),
    markRead: (userId: string, ids?: readonly string[]) => notifier.repo.markRead(userId, ids),
    dispose() {
      closed = true;
      for (const { stop } of watches.values()) stop();
      watches.clear();
    },
  };
}

export type AlertService = ReturnType<typeof createAlertService>;
