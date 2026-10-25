import type { PriceAlert } from '@nthstock/contracts';
import type {
  NewNotification,
  NotificationsRepo,
  StoredNotification,
} from '../notifications/index.js';

/** Triggered and cancelled alerts kept for the list, newest first, after the active ones. */
export const ENDED_ALERTS_LISTED = 20;

/** An active alert and whose it is: what the watchers and the matcher hold. */
export type ActiveAlert = { userId: string; alert: PriceAlert };

/** A fired alert, now TRIGGERED, with the notification stored in the same transaction. */
export type FiredAlert = { userId: string; alert: PriceAlert; stored: StoredNotification };

export type CancelResult = PriceAlert | 'NOT_FOUND' | 'INVALID_STATE';

/**
 * Storage for price alerts (NSTOCK-0383). `fire` is the one way an alert leaves ACTIVE by price:
 * it moves the alert to TRIGGERED only if it is still ACTIVE and writes its notification and outbox
 * row with it, so an alert fires exactly once however many processes see the crossing tick.
 */
export interface AlertsRepo {
  /** Active alerts newest first, then the latest `ENDED_ALERTS_LISTED` ended ones. */
  list(userId: string): Promise<PriceAlert[]>;
  countActive(userId: string): Promise<number>;
  insert(userId: string, alert: PriceAlert): Promise<void>;
  cancel(userId: string, id: string): Promise<CancelResult>;
  /** Every active alert, oldest first (loaded at boot and by the matcher's reconcile). */
  active(): Promise<ActiveAlert[]>;
  /** Null when the alert is no longer ACTIVE (another process fired it, or it was cancelled). */
  fire(
    alertId: string,
    ltp: number,
    at: Date,
    notification: (fired: ActiveAlert) => NewNotification,
  ): Promise<FiredAlert | null>;
  reset(): Promise<void>;
}

const listed = (alerts: readonly PriceAlert[]) => {
  const newest = alerts.toSorted((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return [
    ...newest.filter((alert) => alert.status === 'ACTIVE'),
    ...newest.filter((alert) => alert.status !== 'ACTIVE').slice(0, ENDED_ALERTS_LISTED),
  ];
};

/** The memory repo, for unit tests and `DB_DRIVER=memory`; notifications go to `notifications`. */
export function createMemoryAlertsRepo({
  notifications,
}: {
  notifications: NotificationsRepo;
}): AlertsRepo {
  const alerts = new Map<string, ActiveAlert>();
  const of = (userId: string) =>
    [...alerts.values()].filter((row) => row.userId === userId).map((row) => row.alert);
  return {
    list: (userId) => Promise.resolve(listed(of(userId))),
    countActive: (userId) =>
      Promise.resolve(of(userId).filter((alert) => alert.status === 'ACTIVE').length),
    insert(userId, alert) {
      alerts.set(alert.id, { userId, alert });
      return Promise.resolve();
    },
    cancel(userId, id) {
      const row = alerts.get(id);
      if (!row || row.userId !== userId) return Promise.resolve('NOT_FOUND');
      if (row.alert.status !== 'ACTIVE') return Promise.resolve('INVALID_STATE');
      const alert: PriceAlert = { ...row.alert, status: 'CANCELLED' };
      alerts.set(id, { userId, alert });
      return Promise.resolve(alert);
    },
    active: () =>
      Promise.resolve([...alerts.values()].filter((row) => row.alert.status === 'ACTIVE')),
    async fire(alertId, ltp, at, notification) {
      const row = alerts.get(alertId);
      if (row?.alert.status !== 'ACTIVE') return null;
      const alert: PriceAlert = {
        ...row.alert,
        status: 'TRIGGERED',
        triggeredAt: at.toISOString(),
        triggeredLtp: ltp,
      };
      // Taken synchronously with the check, so two firings cannot both win.
      alerts.set(alertId, { userId: row.userId, alert });
      try {
        const [stored] = await notifications.appendMany([
          { ...notification({ userId: row.userId, alert }), alert },
        ]);
        if (!stored) throw new Error('the alert notification was not stored');
        return { userId: row.userId, alert, stored };
      } catch (error) {
        // The alert and its notification go together or not at all, as in one transaction.
        alerts.set(alertId, row);
        throw error;
      }
    },
    reset() {
      alerts.clear();
      return Promise.resolve();
    },
  };
}
