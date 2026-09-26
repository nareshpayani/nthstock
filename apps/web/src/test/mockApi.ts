import { createApiClient } from '@nthstock/apiClient';
import { TEST_API_ORIGIN, createMockServer } from '@/mocks/node';

/**
 * The MSW node server with the real market handlers, a client pointed at it and a log of every
 * request URL, for component tests on mock data. Call `listen()` in beforeAll, `reset()` in
 * afterEach and `close()` in afterAll.
 */
export function createMockApi() {
  // A fixed seed and a market that never ticks on its own: data is the same on every run.
  const { server, adapter } = createMockServer();
  const requests: URL[] = [];
  server.events.on('request:start', ({ request }) => {
    requests.push(new URL(request.url));
  });
  return {
    server,
    adapter,
    apiClient: createApiClient({ baseUrl: TEST_API_ORIGIN }),
    requests,
    /** Requests whose path ends with `suffix`, e.g. `/candles`. */
    requestsTo(suffix: string) {
      return requests.filter((url) => url.pathname.endsWith(suffix));
    },
    listen() {
      server.listen({ onUnhandledRequest: 'error' });
    },
    reset() {
      server.resetHandlers();
      requests.length = 0;
    },
    close() {
      server.close();
      adapter.dispose();
    },
  };
}
