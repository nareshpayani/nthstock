import { createApiClient } from '@nthstock/apiClient';
import { fixedClock, fromIst } from '@nthstock/utils';
import { TEST_API_ORIGIN, createMockServer } from '@/mocks/node';

/**
 * The MSW node server with the real market handlers, a client pointed at it and a log of every
 * request URL, for component tests on mock data. Call `listen()` in beforeAll, `reset()` in
 * afterEach and `close()` in afterAll.
 */
export function createMockApi() {
  // A fixed seed and a fixed clock after Friday's close (25 Sep 2026, 16:00 IST): the market does
  // not tick and every price is the same on every run, whatever the wall clock says.
  const { server, adapter } = createMockServer({
    clock: fixedClock(fromIst(2026, 9, 25, 16 * 60)),
  });
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
