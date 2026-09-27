import type { Watchlist } from '@nthstock/contracts';
import type { SymbolMaster } from '@nthstock/marketData';
import {
  DEMO_SEED_USER,
  PAPER_ENGINE_SNAPSHOT_VERSION,
  buildDemoAccount,
  demoWatchlists,
  type DemoInstrument,
  type PaperEngineSnapshot,
} from '@nthstock/paperEngine';
import { ORDERS_MOCK_STORAGE_KEY, WATCHLIST_MOCK_STORAGE_KEY } from './handlers';

/**
 * The demo seed for msw mode (T-174): open the app with `?demo=1` and the demo user (mobile
 * 9000000001, dev OTP 123456) starts with the same watchlists, holdings and ledger as
 * `npm run seed:demo` gives in api mode. Both load the state from `@nthstock/paperEngine`
 * (`demoSeed.ts`). Runbook: `docs/runbooks/local-demo.md`.
 *
 * The watchlist and order mocks restore their state from sessionStorage on start, so the seed is
 * written there, in their own formats, before they start. Other users' state is kept.
 */

/** `?demo=1` asks for the demo seed. */
export const DEMO_QUERY_PARAM = 'demo';

export function wantsDemo(search: string): boolean {
  return new URLSearchParams(search).get(DEMO_QUERY_PARAM) === '1';
}

/** The URL without `demo=1`, so a reload keeps the demo's changes instead of seeding again. */
export function withoutDemoParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(DEMO_QUERY_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function demoInstrumentsOfMaster(master: Pick<SymbolMaster, 'equities'>): DemoInstrument[] {
  return master.equities.map(({ instrument, basePrice }) => ({
    token: instrument.token,
    symbol: instrument.symbol,
    exchange: instrument.exchange,
    name: instrument.name,
    basePrice,
  }));
}

type SeedStorage = Pick<Storage, 'getItem' | 'setItem'>;

function readObject(storage: SeedStorage, key: string): Record<string, unknown> {
  try {
    const saved = storage.getItem(key);
    const parsed: unknown = saved ? JSON.parse(saved) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Unreadable: start from nothing.
  }
  return {};
}

/**
 * Writes the demo user's watchlists and paper account where the mocks read them. Returns false when
 * storage refuses the write (the app then starts without the demo state).
 */
export function seedMockDemo(
  storage: SeedStorage,
  master: Pick<SymbolMaster, 'equities'>,
): boolean {
  const instruments = demoInstrumentsOfMaster(master);
  const lists: Record<string, Watchlist[]> = {
    ...(readObject(storage, WATCHLIST_MOCK_STORAGE_KEY) as Record<string, Watchlist[]>),
    [DEMO_SEED_USER.id]: demoWatchlists(instruments),
  };
  const saved = readObject(storage, ORDERS_MOCK_STORAGE_KEY);
  const users =
    saved['v'] === PAPER_ENGINE_SNAPSHOT_VERSION &&
    saved['users'] &&
    typeof saved['users'] === 'object'
      ? (saved['users'] as Record<string, PaperEngineSnapshot>)
      : {};
  const orders = {
    v: PAPER_ENGINE_SNAPSHOT_VERSION,
    users: { ...users, [DEMO_SEED_USER.id]: buildDemoAccount(instruments) },
  };
  try {
    storage.setItem(WATCHLIST_MOCK_STORAGE_KEY, JSON.stringify(lists));
    storage.setItem(ORDERS_MOCK_STORAGE_KEY, JSON.stringify(orders));
    return true;
  } catch {
    return false;
  }
}
