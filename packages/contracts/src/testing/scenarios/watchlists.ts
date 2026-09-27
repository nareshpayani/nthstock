import { expect } from 'vitest';
import { DEV_OTP } from '../../auth.js';
import type { SearchHit } from '../../market.js';
import {
  WATCHLIST_DEFAULT_NAME,
  WATCHLIST_MAX_ITEMS,
  WATCHLIST_MAX_LISTS,
  WATCHLIST_MESSAGES,
  type Watchlist,
} from '../../watchlist.js';
import { defineScenarios, type ScenarioClient } from '../harness.js';

/**
 * Watchlist scenarios (T-117): the rules of T-115 (apps/api) and T-116 (MSW) run against both mock
 * backends. Each scenario logs in with its own mobile number, so it starts with only the default
 * list. Stocks come from market search, so tokens match the backend's symbol master.
 */

const expectError = async (
  pending: ReturnType<ScenarioClient['callError']>,
  status: number,
  code: string,
  message?: string,
) => {
  const { status: actual, body } = await pending;
  expect(actual).toBe(status);
  expect(body.error.code).toBe(code);
  if (message !== undefined) expect(body.error.message).toBe(message);
};

async function login(client: ScenarioClient, mobile: string) {
  const { requestId } = await client.call('otpRequest', { body: { mobile } });
  return client.call('otpVerify', { body: { requestId, mobile, otp: DEV_OTP } });
}

/** Logs in and answers with the user's only list, the default one. */
async function loginWithDefault(client: ScenarioClient, mobile: string): Promise<Watchlist> {
  await login(client, mobile);
  const { items } = await client.call('watchlistsList');
  expect(items).toHaveLength(1);
  const [list] = items;
  if (!list) throw new Error('No default watchlist');
  return list;
}

async function stock(client: ScenarioClient, symbol: string): Promise<SearchHit> {
  const { items } = await client.call('marketSearch', { query: { q: symbol, limit: 5 } });
  const hit = items.find((item) => item.symbol === symbol);
  if (!hit) throw new Error(`${symbol} is not in the symbol master`);
  return hit;
}

/** `count` distinct equities from the symbol master (several searches, as one is capped at 50). */
async function equities(client: ScenarioClient, count: number): Promise<SearchHit[]> {
  const found = new Map<number, SearchHit>();
  for (const q of ['a', 'e', 'i', 'o', 'u', 'n', 's', 't']) {
    const { items } = await client.call('marketSearch', { query: { q, limit: 50 } });
    for (const hit of items) if (hit.type === 'EQUITY') found.set(hit.token, hit);
    if (found.size >= count) return [...found.values()].slice(0, count);
  }
  throw new Error(`Found only ${String(found.size)} equities`);
}

const tokensOf = (list: Watchlist) => list.items.map((item) => item.token);

export const watchlistScenarios = defineScenarios('watchlists', [
  // ---- Default list and auth --------------------------------------------------------------
  {
    name: 'default: a new user gets one empty "My Watchlist", and it stays the same one',
    async run(client) {
      const list = await loginWithDefault(client, '8200000001');

      expect(list).toMatchObject({ name: WATCHLIST_DEFAULT_NAME, items: [] });
      const again = await client.call('watchlistsList');
      expect(again.items.map((l) => l.id)).toEqual([list.id]);
    },
  },
  {
    name: 'auth: every watchlist route needs a session, and a write needs the CSRF token',
    async run(client) {
      await expectError(client.callError('watchlistsList'), 401, 'UNAUTHORIZED');
      await expectError(
        client.callError('watchlistCreate', { body: { name: 'Banks' } }),
        401,
        'UNAUTHORIZED',
      );
      const list = await loginWithDefault(client, '8200000002');

      await expectError(
        client.callError('watchlistRename', {
          params: { id: list.id },
          body: { name: 'Mine' },
          csrf: 'not-the-token',
        }),
        403,
        'FORBIDDEN',
      );
      await expectError(
        client.callError('watchlistCreate', { body: { name: 'Banks' }, csrf: false }),
        403,
        'FORBIDDEN',
      );
    },
  },
  {
    name: "isolation: one user cannot see or change another user's list",
    async run(client) {
      const mine = await loginWithDefault(client, '8200000003');
      await client.call('logout');
      await loginWithDefault(client, '8200000004');

      await expectError(
        client.callError('watchlistRename', { params: { id: mine.id }, body: { name: 'Taken' } }),
        404,
        'NOT_FOUND',
        WATCHLIST_MESSAGES.notFound,
      );
      await expectError(
        client.callError('watchlistDelete', { params: { id: mine.id } }),
        404,
        'NOT_FOUND',
      );
    },
  },

  // ---- Lists ------------------------------------------------------------------------------
  {
    name: 'lists: create, rename and delete; names are trimmed and unique ignoring case',
    async run(client) {
      const first = await loginWithDefault(client, '8200000005');

      const banks = await client.call('watchlistCreate', { body: { name: '  Banks  ' } });
      expect(banks).toMatchObject({ name: 'Banks', items: [] });
      await expectError(
        client.callError('watchlistCreate', { body: { name: 'banks' } }),
        409,
        'CONFLICT',
        WATCHLIST_MESSAGES.duplicateName,
      );
      await expectError(
        client.callError('watchlistRename', {
          params: { id: banks.id },
          body: { name: WATCHLIST_DEFAULT_NAME.toUpperCase() },
        }),
        409,
        'CONFLICT',
        WATCHLIST_MESSAGES.duplicateName,
      );

      const renamed = await client.call('watchlistRename', {
        params: { id: banks.id },
        body: { name: 'PSU banks' },
      });
      expect(renamed).toMatchObject({ id: banks.id, name: 'PSU banks' });
      // Renaming to its own name in another case is fine.
      await client.call('watchlistRename', {
        params: { id: banks.id },
        body: { name: 'PSU Banks' },
      });

      expect(await client.call('watchlistDelete', { params: { id: banks.id } })).toEqual({
        ok: true,
      });
      const { items } = await client.call('watchlistsList');
      expect(items.map((l) => l.id)).toEqual([first.id]);
      await expectError(
        client.callError('watchlistDelete', { params: { id: banks.id } }),
        404,
        'NOT_FOUND',
      );
    },
  },
  {
    name: 'lists: an empty or too-long name is 400',
    async run(client) {
      await loginWithDefault(client, '8200000006');
      await expectError(
        client.callError('watchlistCreate', { body: { name: '   ' } }),
        400,
        'VALIDATION_ERROR',
      );
      await expectError(
        client.callError('watchlistCreate', { body: { name: 'x'.repeat(31) } }),
        400,
        'VALIDATION_ERROR',
      );
    },
  },
  {
    name: 'lists: the 11th list is 409 LIMIT_REACHED and the last list cannot be deleted',
    async run(client) {
      const first = await loginWithDefault(client, '8200000007');
      for (let n = 2; n <= WATCHLIST_MAX_LISTS; n += 1) {
        await client.call('watchlistCreate', { body: { name: `List ${String(n)}` } });
      }

      await expectError(
        client.callError('watchlistCreate', { body: { name: 'One too many' } }),
        409,
        'LIMIT_REACHED',
        WATCHLIST_MESSAGES.listLimit,
      );

      const { items } = await client.call('watchlistsList');
      expect(items).toHaveLength(WATCHLIST_MAX_LISTS);
      for (const list of items.slice(1)) {
        await client.call('watchlistDelete', { params: { id: list.id } });
      }
      await expectError(
        client.callError('watchlistDelete', { params: { id: first.id } }),
        409,
        'CONFLICT',
        WATCHLIST_MESSAGES.lastList,
      );
    },
  },
  {
    name: 'lists: reorder persists; a stale or partial order is 409',
    async run(client) {
      const first = await loginWithDefault(client, '8200000008');
      const second = await client.call('watchlistCreate', { body: { name: 'Second' } });
      const third = await client.call('watchlistCreate', { body: { name: 'Third' } });

      const reordered = await client.call('watchlistsReorder', {
        body: { ids: [third.id, first.id, second.id] },
      });
      expect(reordered.items.map((l) => l.id)).toEqual([third.id, first.id, second.id]);
      const { items } = await client.call('watchlistsList');
      expect(items.map((l) => l.id)).toEqual([third.id, first.id, second.id]);

      await expectError(
        client.callError('watchlistsReorder', { body: { ids: [first.id, second.id] } }),
        409,
        'CONFLICT',
        WATCHLIST_MESSAGES.staleOrder,
      );
      await expectError(
        client.callError('watchlistsReorder', {
          body: { ids: [first.id, second.id, 'wl_unknown'] },
        }),
        409,
        'CONFLICT',
      );
      await expectError(
        client.callError('watchlistsReorder', { body: { ids: [first.id, first.id] } }),
        400,
        'VALIDATION_ERROR',
      );
    },
  },

  // ---- Items ------------------------------------------------------------------------------
  {
    name: 'items: add copies the stock from the symbol master; a repeat is 409; remove works',
    async run(client) {
      const list = await loginWithDefault(client, '8200000009');
      const infy = await stock(client, 'INFY');
      const tcs = await stock(client, 'TCS');

      const added = await client.call('watchlistItemAdd', {
        params: { id: list.id },
        body: { token: infy.token },
      });
      expect(added.items).toEqual([
        {
          token: infy.token,
          symbol: 'INFY',
          exchange: infy.exchange,
          name: infy.name,
          addedAt: expect.any(String) as unknown,
        },
      ]);
      await client.call('watchlistItemAdd', {
        params: { id: list.id },
        body: { token: tcs.token },
      });
      await expectError(
        client.callError('watchlistItemAdd', {
          params: { id: list.id },
          body: { token: infy.token },
        }),
        409,
        'CONFLICT',
        WATCHLIST_MESSAGES.duplicateItem('INFY'),
      );

      const removed = await client.call('watchlistItemRemove', {
        params: { id: list.id, token: infy.token },
      });
      expect(tokensOf(removed)).toEqual([tcs.token]);
      await expectError(
        client.callError('watchlistItemRemove', { params: { id: list.id, token: infy.token } }),
        404,
        'NOT_FOUND',
        WATCHLIST_MESSAGES.itemNotInList,
      );
      const { items } = await client.call('watchlistsList');
      expect(items[0] && tokensOf(items[0])).toEqual([tcs.token]);
    },
  },
  {
    name: 'items: an unknown stock or list is 404; a malformed token is 400',
    async run(client) {
      const list = await loginWithDefault(client, '8200000010');
      const infy = await stock(client, 'INFY');

      await expectError(
        client.callError('watchlistItemAdd', {
          params: { id: list.id },
          body: { token: 999_999_999 },
        }),
        404,
        'NOT_FOUND',
        WATCHLIST_MESSAGES.unknownStock,
      );
      await expectError(
        client.callError('watchlistItemAdd', {
          params: { id: 'wl_unknown' },
          body: { token: infy.token },
        }),
        404,
        'NOT_FOUND',
        WATCHLIST_MESSAGES.notFound,
      );
      await expectError(
        client.callError('watchlistItemRemove', { params: { id: list.id, token: 'abc' } }),
        400,
        'VALIDATION_ERROR',
      );
    },
  },
  {
    name: 'items: the 51st stock is 409 LIMIT_REACHED with a plain-language message',
    async run(client) {
      const list = await loginWithDefault(client, '8200000011');
      const stocks = await equities(client, WATCHLIST_MAX_ITEMS + 1);

      let latest = list;
      for (const hit of stocks.slice(0, WATCHLIST_MAX_ITEMS)) {
        latest = await client.call('watchlistItemAdd', {
          params: { id: list.id },
          body: { token: hit.token },
        });
      }
      expect(latest.items).toHaveLength(WATCHLIST_MAX_ITEMS);

      const extra = stocks[WATCHLIST_MAX_ITEMS];
      if (!extra) throw new Error('Missing the 51st stock');
      await expectError(
        client.callError('watchlistItemAdd', {
          params: { id: list.id },
          body: { token: extra.token },
        }),
        409,
        'LIMIT_REACHED',
        WATCHLIST_MESSAGES.itemLimit,
      );
      const { items } = await client.call('watchlistsList');
      expect(items[0]?.items).toHaveLength(WATCHLIST_MAX_ITEMS);
    },
  },
  {
    name: 'items: reorder persists; a stale order is 409 and leaves the order alone',
    async run(client) {
      const list = await loginWithDefault(client, '8200000012');
      const [a, b, c] = await equities(client, 3);
      if (!a || !b || !c) throw new Error('Need three stocks');
      for (const hit of [a, b, c]) {
        await client.call('watchlistItemAdd', {
          params: { id: list.id },
          body: { token: hit.token },
        });
      }

      const reordered = await client.call('watchlistItemsReorder', {
        params: { id: list.id },
        body: { tokens: [c.token, a.token, b.token] },
      });
      expect(tokensOf(reordered)).toEqual([c.token, a.token, b.token]);

      await expectError(
        client.callError('watchlistItemsReorder', {
          params: { id: list.id },
          body: { tokens: [a.token, b.token] },
        }),
        409,
        'CONFLICT',
        WATCHLIST_MESSAGES.staleOrder,
      );
      const { items } = await client.call('watchlistsList');
      expect(items[0] && tokensOf(items[0])).toEqual([c.token, a.token, b.token]);
    },
  },
]);
