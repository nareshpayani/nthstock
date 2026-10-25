import {
  NOTIFICATION_EVENT_VERSION,
  notifyChannel,
  type NotificationEvent,
} from '@nthstock/contracts';
import type { Publisher, PublisherLog } from '../../ticks/publisher.js';
import type { Notifier } from './notifier.js';
import type { StoredNotification } from './schema.js';

/** The relay's pace and the age it leaves to the writer (spec §6.2: both 5 s). */
export const OUTBOX_RELAY_MS = 5_000;
const RELAY_BATCH = 500;

export type NotificationPublisher = {
  /** One relay pass now (tests; the timer runs it every `relayMs`). Resolves to rows published. */
  relay(): Promise<number>;
  stop(): void;
};

/**
 * Publishes notifications on each user's `notifyChannel` (NSTOCK-0380), for apps/realtime to send
 * to that user's sockets. Every committed notification is published at once and its outbox row
 * deleted; the relay publishes rows older than `relayMs` (a crash between commit and publish, or
 * a Redis outage) every `relayMs`, then deletes them. Delivery is at least once: the event carries
 * the notification id and the web app drops an id it already holds. A failed publish is logged
 * once until publishing recovers.
 */
export function startNotificationPublisher(options: {
  notifier: Notifier;
  publisher: Publisher;
  log: PublisherLog;
  /** Default `OUTBOX_RELAY_MS`; null runs no timer (tests call `relay`). */
  relayMs?: number | null;
  now?: () => number;
}): NotificationPublisher {
  const { notifier, publisher, log } = options;
  const relayMs = options.relayMs === undefined ? OUTBOX_RELAY_MS : options.relayMs;
  const now = options.now ?? Date.now;
  const { repo } = notifier;
  let failing = false;
  const failed = (error: unknown) => {
    if (failing) return;
    failing = true;
    log.warn(
      `Notification publishing failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  };
  const publish = async ({ userId, notification, alert }: StoredNotification) => {
    const event: NotificationEvent = {
      v: NOTIFICATION_EVENT_VERSION,
      userId,
      notification,
      ...(alert ? { alert } : {}),
    };
    await publisher.publish(notifyChannel(userId), JSON.stringify(event));
    if (failing) log.info('Notification publishing recovered');
    failing = false;
  };

  const stopListening = notifier.onCommitted((stored) => {
    publish(stored)
      .then(() => repo.clearOutbox([stored.notification.id]))
      .catch(failed);
  });

  let running: Promise<number> | null = null;
  const relayOnce = async () => {
    const pending = await repo.pendingOutbox(new Date(now() - (relayMs ?? 0)), RELAY_BATCH);
    const done: string[] = [];
    for (const stored of pending) {
      try {
        await publish(stored);
        done.push(stored.notification.id);
      } catch (error) {
        failed(error);
        break;
      }
    }
    await repo.clearOutbox(done);
    return done.length;
  };
  const relay = () => {
    // One pass at a time; a slow pass is not overlapped by the next tick.
    running ??= relayOnce().finally(() => {
      running = null;
    });
    return running;
  };
  const timer =
    relayMs === null
      ? null
      : setInterval(() => {
          relay().catch(failed);
        }, relayMs);
  timer?.unref();

  return {
    relay,
    stop() {
      stopListening();
      if (timer) clearInterval(timer);
    },
  };
}
