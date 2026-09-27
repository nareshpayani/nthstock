// @vitest-environment node
import { DEV_OTP } from '@nthstock/contracts';
import { createScenarioClient, fetchBackend } from '@nthstock/contracts/testing';
import { generateSymbolMaster } from '@nthstock/marketData';
import { DEMO_SEED_USER, buildDemoAccount, demoWatchlists } from '@nthstock/paperEngine';
import { fixedClock, fromIst } from '@nthstock/utils';
import { afterEach, describe, expect, it } from 'vitest';
import { demoInstrumentsOfMaster, seedMockDemo, wantsDemo, withoutDemoParam } from './demoSeed';
import { ORDERS_MOCK_STORAGE_KEY, WATCHLIST_MOCK_STORAGE_KEY } from './handlers';
import { TEST_API_ORIGIN, createMockServer } from './node';

// T-174: ?demo=1 in msw mode gives the demo user the same starting state as `npm run seed:demo` in
// api mode. apps/api's src/modules/demo/seed.test.ts checks its answers against the same builders.

/** Monday 28 Sep 2026, 10:00 IST: after the seeded trades, market open. */
const OPEN_MS = fromIst(2026, 9, 28, 10 * 60).getTime();
const master = generateSymbolMaster();
const instruments = demoInstrumentsOfMaster(master);

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** One msw-mode page load over `storage`, logged in as the demo user. */
async function demoPage(storage: ReturnType<typeof memoryStorage>) {
  const mock = createMockServer({
    clock: fixedClock(OPEN_MS),
    tickIntervalMs: 1_000_000_000,
    auth: { now: () => OPEN_MS },
    watchlists: { now: () => OPEN_MS, storage },
    orders: { storage },
  });
  mock.server.listen({ onUnhandledRequest: 'error' });
  cleanups.push(() => {
    mock.server.close();
    mock.orders.dispose();
    mock.adapter.dispose();
  });
  const client = createScenarioClient(fetchBackend(TEST_API_ORIGIN, fetch));
  const mobile = DEMO_SEED_USER.mobile;
  const { requestId } = await client.call('otpRequest', { body: { mobile } });
  await client.call('otpVerify', { body: { requestId, mobile, otp: DEV_OTP } });
  return client;
}

describe('?demo=1 (T-174)', () => {
  it('reads and drops the demo parameter', () => {
    expect(wantsDemo('?demo=1')).toBe(true);
    expect(wantsDemo('?demo=0')).toBe(false);
    expect(wantsDemo('')).toBe(false);
    expect(withoutDemoParam('http://127.0.0.1:4173/dashboard?demo=1&x=2#top')).toBe(
      '/dashboard?x=2#top',
    );
  });

  it('gives the demo user the demo watchlists, holdings, ledger and orders', async () => {
    const storage = memoryStorage();
    expect(seedMockDemo(storage, master)).toBe(true);
    const client = await demoPage(storage);
    const account = buildDemoAccount(instruments);

    const lists = await client.call('watchlistsList', {});
    expect(lists.items).toEqual(demoWatchlists(instruments));

    const byToken = (a: { token: number }, b: { token: number }) => a.token - b.token;
    const holdings = await client.call('holdingsList', {});
    expect(
      holdings.items
        .map(({ token, qty, investedValue }) => ({ token, qty, investedValue }))
        .sort(byToken),
    ).toEqual(
      account.holdings
        .map(({ token, lot }) => ({ token, qty: lot.qty, investedValue: lot.investedValue }))
        .sort(byToken),
    );

    const ledger = await client.call('fundsLedger', { query: { limit: 100 } });
    expect(ledger.items).toEqual([...account.ledger].reverse());

    const funds = await client.call('fundsSummary', {});
    expect(funds.available).toBe(account.ledger.at(-1)?.balanceAfter);

    const orders = await client.call('ordersList', { query: { limit: 100 } });
    expect(orders.items.map((order) => order.id).sort()).toEqual(
      account.orders.map((order) => order.id).sort(),
    );
  });

  it("keeps other users' saved state and replaces the demo user's", () => {
    const other = { usr_other: [] };
    const storage = memoryStorage({
      [WATCHLIST_MOCK_STORAGE_KEY]: JSON.stringify({ ...other, [DEMO_SEED_USER.id]: [] }),
      [ORDERS_MOCK_STORAGE_KEY]: 'not json',
    });
    seedMockDemo(storage, master);
    const lists = JSON.parse(storage.data.get(WATCHLIST_MOCK_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown[]
    >;
    expect(lists['usr_other']).toEqual([]);
    expect(lists[DEMO_SEED_USER.id]).toHaveLength(2);
    const orders = JSON.parse(storage.data.get(ORDERS_MOCK_STORAGE_KEY) ?? '{}') as {
      users: Record<string, unknown>;
    };
    expect(Object.keys(orders.users)).toEqual([DEMO_SEED_USER.id]);
  });

  it('reports a storage that refuses the write', () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(seedMockDemo(full, master)).toBe(false);
  });
});
