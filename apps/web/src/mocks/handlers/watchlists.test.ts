// @vitest-environment node
import {
  AUTH_CSRF_HEADER,
  DEV_OTP,
  Session,
  Watchlist,
  WatchlistsResponse,
  buildPath,
  routes,
  type Instrument,
  type RouteName,
} from '@nthstock/contracts';
import { getResponse, type HttpHandler } from 'msw';
import { describe, expect, it } from 'vitest';
import { setMockLatency } from '../handlerKit';
import { createAuthMock } from './auth';
import { WATCHLIST_MOCK_STORAGE_KEY, createWatchlistMock } from './watchlists';

setMockLatency(0);
const ORIGIN = 'http://lists.test';

const INFY: Instrument = {
  token: 408065,
  symbol: 'INFY',
  exchange: 'NSE',
  name: 'Infosys',
  type: 'EQUITY',
  isin: null,
  sector: null,
  lotSize: 1,
  tickSize: 5,
};
const adapter = { listInstruments: () => Promise.resolve([INFY]) };

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/**
 * One page load of the app in msw mode: the auth mock and the watchlist mock over the given
 * storages, called with a Bearer token so no cookie store is needed.
 */
function pageLoad(authStorage: Storage, listStorage: Storage) {
  const auth = createAuthMock({ storage: authStorage });
  const handlers: HttpHandler[] = [
    ...auth.handlers(),
    ...createWatchlistMock(adapter, auth, { storage: listStorage }).handlers(),
  ];
  let token = '';
  async function call(
    name: RouteName,
    input: { params?: Record<string, string | number>; body?: unknown } = {},
  ) {
    const def = routes[name];
    const headers = new Headers({ 'content-type': 'application/json', [AUTH_CSRF_HEADER]: 'x' });
    if (token) headers.set('authorization', `Bearer ${token}`);
    const response = await getResponse(
      handlers,
      new Request(`${ORIGIN}${buildPath(def.path, input.params)}`, {
        method: def.method,
        headers,
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      }),
    );
    if (!response) throw new Error(`no handler for ${name}`);
    return { status: response.status, json: (await response.json()) as unknown };
  }
  async function login(mobile: string) {
    const sent = await call('otpRequest', { body: { mobile } });
    const { requestId } = sent.json as { requestId: string };
    const session = Session.parse(
      (await call('otpVerify', { body: { mobile, requestId, otp: DEV_OTP } })).json,
    );
    token = session.accessToken;
  }
  return {
    call,
    login,
    useToken: (value: string) => {
      token = value;
    },
    token: () => token,
  };
}

describe('watchlist mock (T-116)', () => {
  it('answers schema-valid lists and keeps them across a page reload', async () => {
    const authStorage = memoryStorage();
    const listStorage = memoryStorage();
    const first = pageLoad(authStorage, listStorage);
    await first.login('9876543210');
    const { items } = WatchlistsResponse.parse((await first.call('watchlistsList')).json);
    const id = items[0]?.id ?? '';
    const added = await first.call('watchlistItemAdd', {
      params: { id },
      body: { token: INFY.token },
    });
    expect(added.status).toBe(200);
    expect(Watchlist.parse(added.json).items.map((i) => i.symbol)).toEqual(['INFY']);
    const created = await first.call('watchlistCreate', { body: { name: 'Banks' } });
    const banks = Watchlist.parse(created.json);
    await first.call('watchlistsReorder', { body: { ids: [banks.id, id] } });
    expect(listStorage.data.has(WATCHLIST_MOCK_STORAGE_KEY)).toBe(true);

    // A reload: new mocks over the same storages; the access token is still valid.
    const second = pageLoad(authStorage, listStorage);
    second.useToken(first.token());
    const after = WatchlistsResponse.parse((await second.call('watchlistsList')).json);
    expect(after.items.map((l) => l.name)).toEqual(['Banks', 'My Watchlist']);
    expect(after.items[1]?.items.map((i) => i.token)).toEqual([INFY.token]);
  });

  it('starts fresh and keeps working when storage is unreadable or throws', async () => {
    const broken: Storage = {
      getItem: () => '{not json',
      setItem: () => {
        throw new Error('quota');
      },
    };
    const page = pageLoad(memoryStorage(), broken);
    await page.login('9876543211');
    const { items } = WatchlistsResponse.parse((await page.call('watchlistsList')).json);
    expect(items.map((l) => l.name)).toEqual(['My Watchlist']);
    const created = await page.call('watchlistCreate', { body: { name: 'Banks' } });
    expect(created.status).toBe(200);

    const throwing: Storage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
    };
    const other = pageLoad(memoryStorage(), throwing);
    await other.login('9876543212');
    expect((await other.call('watchlistsList')).status).toBe(200);
  });

  it('ignores stored state that is not an object of lists', async () => {
    const listStorage = memoryStorage();
    listStorage.data.set(WATCHLIST_MOCK_STORAGE_KEY, '[1,2]');
    const page = pageLoad(memoryStorage(), listStorage);
    await page.login('9876543213');
    const { items } = WatchlistsResponse.parse((await page.call('watchlistsList')).json);
    expect(items).toHaveLength(1);
  });

  it('needs a session', async () => {
    const page = pageLoad(memoryStorage(), memoryStorage());
    const response = await page.call('watchlistsList');
    expect(response.status).toBe(401);
  });
});
