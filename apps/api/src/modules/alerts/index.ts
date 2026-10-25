// Public API of the alerts module (price alerts and notifications, NSTOCK-0344, NSTOCK-0383).
// Other modules and the app wiring import it only through this file; tests may import internals.
export { createPgAlertsRepo } from './pgRepo.js';
export { createMemoryAlertsRepo, type AlertsRepo } from './repo.js';
export { alertRoutes } from './routes.js';
export { createAlertService, type AlertService } from './service.js';
