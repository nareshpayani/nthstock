import { MockMarketDataAdapter } from '@nthstock/marketData';
import { healthScenarios, runScenarioSuite, scenarioGroups } from '@nthstock/contracts/testing';
import { systemClock } from '@nthstock/utils';
import { Redis } from 'ioredis';
import { buildApp } from './app.js';
import { createDatabase } from './db/client.js';
import { DEMO_USER } from './modules/users/repo.js';
import { injectBackend } from './test/injectBackend.js';
import { describeWithPostgres, useTestPostgres } from './test/testPostgres.js';
import { describeWithRedis, startTestRedis, uniqueChannel } from './test/testRedis.js';
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

// And against apps/api as it runs with DB_DRIVER=postgres (T-196): users, auth, sessions and the
// audit log in Postgres, OTPs and session revocations in Redis. The scenarios are unchanged; only
// the health group is left out, as it checks the no-backing-service configuration above.
const postgresGroups = scenarioGroups.filter((group) => group !== healthScenarios);
describeWithPostgres('apps/api on Postgres', () => {
  describeWithRedis('and Redis', () => {
    runScenarioSuite('apps/api on Postgres + Redis (app.inject)', postgresGroups, async () => {
      const pg = await useTestPostgres();
      await pg.truncate();
      const database = createDatabase({ url: pg.appUrl, poolMax: 8 });
      const server = await startTestRedis();
      const redis = new Redis(server.url, { maxRetriesPerRequest: 2 });
      const clock = offsetClock();
      const market = new MockMarketDataAdapter({ clock: systemClock, alwaysOpen: false });
      const app = buildApp({
        deps: {
          clock,
          market,
          database,
          redis,
          redisKeyPrefix: `${uniqueChannel('scenarios:api')}:`,
        },
        orderSweepMs: null,
      });
      app.addHook('onClose', async () => {
        market.dispose();
        await redis.quit();
        await server.stop();
        await database.close();
      });
      // As server.ts does at boot outside production.
      await app.deps.repos.users.ensureSeeded(DEMO_USER);
      return injectBackend(app, {
        advanceTime: clock.advance,
        setTime: clock.set,
        setPrice: app.deps.orders.pinPrice,
      });
    });
  });
});
