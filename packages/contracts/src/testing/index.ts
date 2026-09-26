/** Scenario harness and suites for mock backends. Imports Vitest, so keep it out of runtime bundles. */
export {
  ScenarioError,
  createScenarioClient,
  defineScenarios,
  runScenarioSuite,
  toQueryString,
  type BackendRequest,
  type BackendResponse,
  type CallInput,
  type ErrorResult,
  type LooseInput,
  type Scenario,
  type ScenarioBackend,
  type ScenarioClient,
  type ScenarioGroup,
} from './harness.js';
export { fetchBackend, type FetchLike } from './fetchBackend.js';
export { healthScenarios } from './scenarios/health.js';
