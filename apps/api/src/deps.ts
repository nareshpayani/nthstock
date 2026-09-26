import { MockMarketDataAdapter, type MarketDataAdapter } from '@nthstock/marketData';
import { systemClock, type Clock } from '@nthstock/utils';
import { createMemoryUsersRepo, type UsersRepo } from './modules/users/repo.js';

/** Every module's storage seam. In-memory in the mock phase (ADR 0004 §3). */
export type Repos = {
  users: UsersRepo;
};

/** What modules get injected instead of reaching for globals: time, storage and market data. */
export type AppDeps = {
  clock: Clock;
  repos: Repos;
  /** The one market data adapter for this process, created at boot (T-061). */
  market: MarketDataAdapter;
  /** Releases what `createDeps` created itself (the adapter's timers). Injected parts are left alone. */
  dispose(): void;
};

export type DepsOverrides = {
  clock?: Clock;
  repos?: Partial<Repos>;
  /** Use this adapter instead of building a MockMarketDataAdapter (tests share one). */
  market?: MarketDataAdapter;
  /** `MOCK_MARKET_ALWAYS_OPEN`: let the mock market tick outside NSE hours. */
  marketAlwaysOpen?: boolean;
};

/** Builds a fresh set of dependencies; each app (and each test app) gets its own in-memory state. */
export function createDeps(overrides: DepsOverrides = {}): AppDeps {
  const clock = overrides.clock ?? systemClock;
  const market =
    overrides.market ??
    new MockMarketDataAdapter({ clock, alwaysOpen: overrides.marketAlwaysOpen ?? false });
  const owned = overrides.market ? null : market;
  return {
    clock,
    repos: {
      users: overrides.repos?.users ?? createMemoryUsersRepo({ clock }),
    },
    market,
    dispose: () => owned?.dispose(),
  };
}

/** Restores every repo to its seeded state. */
export async function resetRepos(repos: Repos): Promise<void> {
  await Promise.all(Object.values(repos).map((repo) => repo.reset()));
}
