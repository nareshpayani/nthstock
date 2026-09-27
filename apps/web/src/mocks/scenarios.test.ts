import { fetchBackend, runScenarioSuite, scenarioGroups } from '@nthstock/contracts/testing';
import { TEST_API_ORIGIN, createMockServer } from './node';

// The same scenario files run against apps/api through app.inject (ADR 0004, T-060).
runScenarioSuite('MSW node server', scenarioGroups, () => {
  // Scenarios move or set the mock clock (auth, watchlists and orders); the market keeps real
  // time, and order scenarios script the prices the paper engines see instead.
  let offset = 0;
  const { server, adapter, orders } = createMockServer({
    auth: { now: () => Date.now() + offset },
  });
  server.listen({ onUnhandledRequest: 'error' });
  const { hostname } = new URL(TEST_API_ORIGIN);
  return fetchBackend(TEST_API_ORIGIN, fetch, {
    onClose: () => {
      server.close();
      orders.dispose();
      adapter.dispose();
    },
    // Each scenario on its own subdomain: MSW's cookie store keeps its cookies apart.
    scopeOrigin: (index) => `http://s${String(index)}.${hostname}`,
    advanceTime: (ms) => {
      offset += ms;
    },
    setTime: (at) => {
      offset = Date.parse(at) - Date.now();
    },
    setPrice: orders.pinPrice,
  });
});
