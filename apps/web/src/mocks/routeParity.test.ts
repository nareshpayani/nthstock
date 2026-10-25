import { routes } from '@nthstock/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { createMockServer } from './node';

// NSTOCK-0238: the MSW mock serves every route in the map, so the web app on mocks never meets a
// route apps/api has and MSW does not (the scenarios then check what each one answers).
describe('MSW route parity', () => {
  const { server, adapter, orders } = createMockServer();

  afterAll(() => {
    orders.dispose();
    adapter.dispose();
  });

  const served = new Set(
    server.listHandlers().flatMap((handler) => {
      // The WebSocket handler has no `info`.
      const info = (handler as { info?: { method?: unknown; path?: unknown } }).info ?? {};
      if (typeof info.method !== 'string' || typeof info.path !== 'string') return [];
      return [`${info.method.toUpperCase()} ${info.path.replace(/^\*/, '')}`];
    }),
  );

  it.each(Object.entries(routes))('serves %s', (name, def) => {
    expect(served.has(`${def.method} ${def.path}`), `No MSW handler for route "${name}"`).toBe(
      true,
    );
  });
});
