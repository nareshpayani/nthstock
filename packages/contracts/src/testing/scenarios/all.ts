import { authScenarios } from './auth.js';
import { fundsScenarios } from './funds.js';
import { healthScenarios } from './health.js';
import { marketScenarios } from './market.js';
import { orderScenarios } from './orders.js';
import { portfolioScenarios } from './portfolio.js';
import { watchlistScenarios } from './watchlists.js';

/** Every shared scenario group; each backend runner passes this to `runScenarioSuite`. */
export const scenarioGroups = [
  healthScenarios,
  marketScenarios,
  authScenarios,
  watchlistScenarios,
  // Last: order, portfolio and funds scenarios set the backend clock to fixed instants (see
  // scenarios/orders.ts).
  orderScenarios,
  portfolioScenarios,
  fundsScenarios,
] as const;
