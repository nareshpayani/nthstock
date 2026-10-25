import type { NotificationsRepo } from './repo.js';
import type { NewNotification, StoredNotification } from './schema.js';

export type NotificationListener = (stored: StoredNotification) => void;

/**
 * Where committed notifications go (NSTOCK-0379, NSTOCK-0380). A writer that stores notifications
 * inside its own transaction (the account store) calls `committed` once that transaction has
 * committed; `raise` stores and announces notifications that have no transaction of their own.
 * Listeners (the Redis publisher in a running server) hear every committed notification once, in
 * order. A listener that throws is skipped; the outbox relay delivers what it missed.
 */
export type Notifier = {
  readonly repo: NotificationsRepo;
  committed(stored: readonly StoredNotification[]): void;
  raise(entries: readonly NewNotification[]): Promise<StoredNotification[]>;
  onCommitted(listener: NotificationListener): () => void;
};

export function createNotifier({
  repo,
  onListenerError = () => undefined,
}: {
  repo: NotificationsRepo;
  /** A listener that threw; the notification stays in the outbox for the relay. */
  onListenerError?: (error: unknown, stored: StoredNotification) => void;
}): Notifier {
  const listeners = new Set<NotificationListener>();
  const committed = (stored: readonly StoredNotification[]) => {
    for (const item of stored) {
      for (const listener of [...listeners]) {
        try {
          listener(item);
        } catch (error) {
          // The outbox row stays, so the relay publishes it later.
          onListenerError(error, item);
        }
      }
    }
  };
  return {
    repo,
    committed,
    async raise(entries) {
      const stored = await repo.appendMany(entries);
      committed(stored);
      return stored;
    },
    onCommitted(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
