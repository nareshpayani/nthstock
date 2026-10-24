// Public API of the alerts module (price alerts and notifications, NSTOCK-0344). Other modules and
// the app wiring import it only through this file; tests may import internals.
export { alertRoutes } from './routes.js';
export { createAlertService, type AlertService } from './service.js';
