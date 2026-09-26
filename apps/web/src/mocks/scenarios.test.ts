import { fetchBackend, runScenarioSuite, scenarioGroups } from '@nthstock/contracts/testing';
import { TEST_API_ORIGIN, createMockServer } from './node';

// The same scenario files run against apps/api through app.inject (ADR 0004, T-060).
runScenarioSuite('MSW node server', scenarioGroups, () => {
  const { server, adapter } = createMockServer();
  server.listen({ onUnhandledRequest: 'error' });
  return fetchBackend(TEST_API_ORIGIN, fetch, () => {
    server.close();
    adapter.dispose();
  });
});
