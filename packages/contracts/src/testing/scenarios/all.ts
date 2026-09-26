import { healthScenarios } from './health.js';
import { marketScenarios } from './market.js';

/** Every shared scenario group; each backend runner passes this to `runScenarioSuite`. */
export const scenarioGroups = [healthScenarios, marketScenarios] as const;
