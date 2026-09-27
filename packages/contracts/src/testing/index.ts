/** Scenario harness and suites for mock backends. Imports Vitest, so keep it out of runtime bundles. */
export { createCookieJar, type CookieJar, type CookieSnapshot } from './cookieJar.js';
export {
  PRE_SESSION_CSRF,
  ScenarioError,
  createScenarioClient,
  defineScenarios,
  runScenarioSuite,
  toQueryString,
  type BackendRequest,
  type BackendResponse,
  type CallInput,
  type CsrfChoice,
  type ErrorResult,
  type LooseInput,
  type Scenario,
  type ScenarioBackend,
  type ScenarioClient,
  type ScenarioGroup,
} from './harness.js';
export { fetchBackend, type FetchBackendOptions, type FetchLike } from './fetchBackend.js';
export { authScenarios } from './scenarios/auth.js';
export { healthScenarios } from './scenarios/health.js';
export { marketScenarios } from './scenarios/market.js';
export { orderScenarios } from './scenarios/orders.js';
export { portfolioScenarios } from './scenarios/portfolio.js';
export { watchlistScenarios } from './scenarios/watchlists.js';
export { scenarioGroups } from './scenarios/all.js';
