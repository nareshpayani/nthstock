import {
  AUTH_COOKIES,
  WATCHLIST_MESSAGES,
  Watchlist,
  WatchlistsResponse,
  routes,
} from '@nthstock/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { resetRepos } from '../../deps.js';
import { cookieHeader, csrfHeader, loginWithOtp, type LoggedIn } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';

let app: App;
let user: LoggedIn;

beforeEach(async () => {
  app = buildApp({ deps: { clock: manualClock() } });
  user = await loginWithOtp(app, '9876543210');
});

afterEach(async () => {
  await app.close();
});

const bearer = () => ({ authorization: `Bearer ${user.access}` });

async function lists() {
  const response = await app.inject({
    method: 'GET',
    url: routes.watchlistsList.path,
    headers: bearer(),
  });
  expect(response.statusCode).toBe(200);
  return WatchlistsResponse.parse(response.json()).items;
}

describe('watchlist routes (T-115)', () => {
  it('accept a Bearer token without CSRF and the session cookie with it', async () => {
    const [list] = await lists();
    const created = await app.inject({
      method: 'POST',
      url: routes.watchlistCreate.path,
      headers: { ...bearer(), 'x-csrf-token': 'any' },
      payload: { name: 'Banks' },
    });
    expect(created.statusCode).toBe(200);
    expect(Watchlist.parse(created.json()).name).toBe('Banks');

    const rename = (headers: Record<string, string>) =>
      app.inject({
        method: 'PATCH',
        url: `/v1/watchlists/${list?.id ?? ''}`,
        headers: { cookie: cookieHeader({ [AUTH_COOKIES.access]: user.access }), ...headers },
        payload: { name: 'Core' },
      });
    expect((await rename({ 'x-csrf-token': 'wrong' })).statusCode).toBe(403);
    const renamed = await rename(csrfHeader(user.csrf));
    expect(renamed.statusCode).toBe(200);
    expect(Watchlist.parse(renamed.json()).name).toBe('Core');
  });

  it('answer the 51st stock with 409 and a plain-language message', async () => {
    const [list] = await lists();
    const id = list?.id ?? '';
    const tokens = (await app.deps.market.listInstruments())
      .filter((i) => i.type === 'EQUITY')
      .slice(0, 51)
      .map((i) => i.token);
    for (const token of tokens.slice(0, 50)) {
      const ok = await app.inject({
        method: 'POST',
        url: `/v1/watchlists/${id}/items`,
        headers: { ...bearer(), 'x-csrf-token': 'x' },
        payload: { token },
      });
      expect(ok.statusCode).toBe(200);
    }
    const full = await app.inject({
      method: 'POST',
      url: `/v1/watchlists/${id}/items`,
      headers: { ...bearer(), 'x-csrf-token': 'x' },
      payload: { token: tokens[50] },
    });
    expect(full.statusCode).toBe(409);
    expect(full.json()).toEqual({
      error: { code: 'LIMIT_REACHED', message: WATCHLIST_MESSAGES.itemLimit },
    });
  }, 20_000);

  it('persist a reorder until the repos are reset', async () => {
    const [first] = await lists();
    const second = Watchlist.parse(
      (
        await app.inject({
          method: 'POST',
          url: routes.watchlistCreate.path,
          headers: { ...bearer(), 'x-csrf-token': 'x' },
          payload: { name: 'Second' },
        })
      ).json(),
    );
    const order = [second.id, first?.id ?? ''];
    const reordered = await app.inject({
      method: 'PUT',
      url: routes.watchlistsReorder.path,
      headers: { ...bearer(), 'x-csrf-token': 'x' },
      payload: { ids: order },
    });
    expect(reordered.statusCode).toBe(200);
    expect((await lists()).map((l) => l.id)).toEqual(order);

    await resetRepos(app.deps.repos);
    user = await loginWithOtp(app, '9876543211');
    expect(await lists()).toHaveLength(1);
  });
});
