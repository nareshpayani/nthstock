import { MockMarketDataAdapter } from '@nthstock/marketData';
import { runScenarioSuite, scenarioGroups } from '@nthstock/contracts/testing';
import { systemClock } from '@nthstock/utils';
import { buildApp } from './app.js';
import { injectBackend } from './test/injectBackend.js';
import { offsetClock } from './modules/testControls/offsetClock.js';

// The same scenario files run against the MSW node server in apps/web (ADR 0004).
runScenarioSuite('apps/api (app.inject)', scenarioGroups, () => {
  // Scenarios move or set the app's clock (auth and orders); the market keeps real time, and
  // order scenarios script the prices the paper engines see instead of reading the random walk.
  const clock = offsetClock();
  const market = new MockMarketDataAdapter({ clock: systemClock, alwaysOpen: false });
  const app = buildApp({ deps: { clock, market }, orderSweepMs: null });
  app.addHook('onClose', async () => {
    market.dispose();
  });
  return injectBackend(app, {
    advanceTime: clock.advance,
    setTime: clock.set,
    setPrice: app.deps.orders.pinPrice,
  });
});
