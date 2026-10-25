// Public API of the health module. Other modules and the app wiring import it only through this
// file; tests may import internals.
export { API_VERSION, healthRoutes, type ReadinessCheck } from './routes.js';
