import { randomUUID } from 'node:crypto';
import type {
  CreatePriceAlertRequest,
  NotificationsResponse,
  PriceAlert,
} from '@nthstock/contracts';
import type { MarketDataAdapter } from '@nthstock/marketData';
import { AlertDesk, type AlertActionResult } from '@nthstock/paperEngine';
import type { Clock } from '@nthstock/utils';
import { ApiHttpError } from '../../http/apiError.js';
import type { Notifier } from '../notifications/index.js';

export type AlertServiceOptions = {
  clock: Clock;
  market: MarketDataAdapter;
  /** The notification centre: fired alerts are stored and published through it (NSTOCK-0379). */
  notifier: Notifier;
  /** Logs a fired alert whose notification could not be stored. */
  onNotifyError?: (error: unknown) => void;
  newId?: () => string;
};

const STATUS = { NOT_FOUND: 404, VALIDATION_ERROR: 400, LIMIT_REACHED: 422, INVALID_STATE: 409 };

/**
 * Price alerts (NSTOCK-0344) on the same `AlertDesk` as the MSW mock, kept in process memory, and
 * the notification centre on the notifications store (NSTOCK-0379). A fired alert's notification
 * is stored and published through `notifier`; fills, rejections and trailing stops are raised by
 * the account store inside their commit, so this service no longer listens to orders.
 */
export function createAlertService({
  clock,
  market,
  notifier,
  onNotifyError = () => undefined,
  newId = () => `al_${randomUUID().replaceAll('-', '')}`,
}: AlertServiceOptions) {
  const desk = new AlertDesk({
    clock,
    market,
    newId,
    onNotification(userId, notification, alert) {
      if (notification.kind !== 'PRICE_ALERT') return;
      notifier
        .raise([
          {
            userId,
            kind: notification.kind,
            refId: alert?.id ?? null,
            title: notification.title,
            body: notification.body,
            symbol: notification.symbol,
            exchange: notification.exchange,
            ...(alert ? { alert } : {}),
          },
        ])
        .catch(onNotifyError);
    },
  });

  const answer = (result: AlertActionResult): PriceAlert => {
    if (result.ok) return result.alert;
    const code = result.code === 'INVALID_STATE' ? 'CONFLICT' : result.code;
    throw new ApiHttpError(STATUS[result.code], code, result.message);
  };

  return {
    list: (userId: string) => ({ items: desk.alerts(userId) }),
    create: async (userId: string, request: CreatePriceAlertRequest) =>
      answer(await desk.create(userId, request)),
    cancel: (userId: string, id: string) => answer(desk.cancel(userId, id)),
    notifications: (userId: string): Promise<NotificationsResponse> => notifier.repo.list(userId),
    markRead: (userId: string, ids?: readonly string[]) => notifier.repo.markRead(userId, ids),
    dispose() {
      desk.close();
    },
  };
}

export type AlertService = ReturnType<typeof createAlertService>;
