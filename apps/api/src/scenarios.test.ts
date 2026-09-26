import { MockMarketDataAdapter } from '@nthstock/marketData';
import { runScenarioSuite, scenarioGroups } from '@nthstock/contracts/testing';
import { systemClock } from '@nthstock/utils';
import { buildApp } from './app.js';
import { injectBackend } from './test/injectBackend.js';
import { offsetClock } from './test/offsetClock.js';

// The same scenario files run against the MSW node server in apps/web (ADR 0004).
runScenarioSuite('apps/api (app.inject)', scenarioGroups, () => {
  // Auth scenarios move the app's clock; the market keeps real time.
  const clock = offsetClock();
  const market = new MockMarketDataAdapter({ clock: systemClock, alwaysOpen: false });
  const app = buildApp({ deps: { clock, market } });
  app.addHook('onClose', async () => {
    market.dispose();
  });
  return injectBackend(app, { advanceTime: clock.advance });
});
