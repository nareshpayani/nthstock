// Public API of the notifications module (spec market-data-and-matching §6, NSTOCK-0379 to
// NSTOCK-0382). Other modules and the app wiring import it only through this file; tests may
// import internals.
export { createNotifier, type Notifier } from './notifier.js';
export { createPgNotificationsRepo } from './pgRepo.js';
export {
  OUTBOX_RELAY_MS,
  startNotificationPublisher,
  type NotificationPublisher,
} from './publisher.js';
export { createMemoryNotificationsRepo, type NotificationsRepo } from './repo.js';
export type { NewNotification, StoredNotification } from './schema.js';
export {
  raiseSecurityNotice,
  securityNotification,
  type SecurityEvent,
  type SecurityNotices,
} from './security.js';
