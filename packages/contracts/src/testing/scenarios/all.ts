import { authScenarios } from './auth.js';
import { healthScenarios } from './health.js';
import { marketScenarios } from './market.js';
import { watchlistScenarios } from './watchlists.js';

/** Every shared scenario group; each backend runner passes this to `runScenarioSuite`. */
export const scenarioGroups = [
  healthScenarios,
  marketScenarios,
  authScenarios,
  watchlistScenarios,
] as const;
