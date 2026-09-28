import { AUTH_COOKIES, WatchlistsResponse, routes } from '@nthstock/contracts';
import { expect, it } from 'vitest';
import type { App } from '../../app.js';
import { cookieHeader, csrfHeader, loginWithOtp } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';
import { describeWithPostgresAndRedis } from '../../test/postgresRedisApp.js';

// apps/api with DB_DRIVER=postgres keeps watchlists in Postgres (T-198): a second instance on the
// same database, as after a restart or behind a load balancer, sees the same lists.

const secret = new Uint8Array(32).fill(7);

const call = (
  app: App,
  access: string,
  csrf: string,
  request: { method: 'GET' | 'POST' | 'PUT'; url: string; payload?: object },
) =>
  app.inject({
    ...request,
    headers: { ...csrfHeader(csrf), cookie: cookieHeader({ [AUTH_COOKIES.access]: access }) },
  });

describeWithPostgresAndRedis('watchlists on Postgres (integration, T-198)', ({ app }) => {
  it('keeps lists, stocks and their order across app instances', async () => {
    const clock = manualClock();
    const first = app({ deps: { clock, jwtSecret: secret } });
    const { access, csrf } = await loginWithOtp(first, '9876543210');
    const [a, b] = await first.deps.market.listInstruments();
    if (!a || !b) throw new Error('the mock market has no instruments');

    const created = await call(first, access, csrf, {
      method: 'POST',
      url: routes.watchlistCreate.path,
      payload: { name: 'Banks' },
    });
    expect(created.statusCode).toBe(200);
    const { id } = created.json<{ id: string }>();
    for (const token of [a.token, b.token]) {
      const added = await call(first, access, csrf, {
        method: 'POST',
        url: routes.watchlistItemAdd.path.replace(':id', id),
        payload: { token },
      });
      expect(added.statusCode).toBe(200);
    }
    const reordered = await call(first, access, csrf, {
      method: 'PUT',
      url: routes.watchlistItemsReorder.path.replace(':id', id),
      payload: { tokens: [b.token, a.token] },
    });
    expect(reordered.statusCode).toBe(200);
    const before = WatchlistsResponse.parse(
      (await call(first, access, csrf, { method: 'GET', url: routes.watchlistsList.path })).json(),
    );

    const second = app({ deps: { clock, jwtSecret: secret } });
    const after = WatchlistsResponse.parse(
      (await call(second, access, csrf, { method: 'GET', url: routes.watchlistsList.path })).json(),
    );

    expect(after).toEqual(before);
    expect(after.items.map((list) => list.name)).toEqual(['My Watchlist', 'Banks']);
    expect(after.items[1]?.items.map((item) => item.token)).toEqual([b.token, a.token]);
  });
});
