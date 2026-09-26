import { fetchBackend, runScenarioSuite, scenarioGroups } from '@nthstock/contracts/testing';
import { TEST_API_ORIGIN, createMockServer } from './node';

// The same scenario files run against apps/api through app.inject (ADR 0004, T-060).
runScenarioSuite('MSW node server', scenarioGroups, () => {
  // Auth scenarios move the auth clock forward; the market keeps real time.
  let offset = 0;
  const { server, adapter } = createMockServer({ auth: { now: () => Date.now() + offset } });
  server.listen({ onUnhandledRequest: 'error' });
  const { hostname } = new URL(TEST_API_ORIGIN);
  return fetchBackend(TEST_API_ORIGIN, fetch, {
    onClose: () => {
      server.close();
      adapter.dispose();
    },
    // Each scenario on its own subdomain: MSW's cookie store keeps its cookies apart.
    scopeOrigin: (index) => `http://s${String(index)}.${hostname}`,
    advanceTime: (ms) => {
      offset += ms;
    },
  });
});
