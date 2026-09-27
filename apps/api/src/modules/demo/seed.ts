import { MockMarketDataAdapter, type MarketDataAdapter } from '@nthstock/marketData';
import {
  DEMO_SEED_USER,
  buildDemoAccount,
  demoWatchlists,
  type DemoInstrument,
} from '@nthstock/paperEngine';
import type { AppDeps } from '../../deps.js';
import type { WatchlistRecord } from '../watchlists/schema.js';

/**
 * The demo seed for api mode (T-174): `npm run seed:demo` starts apps/api with `DEMO_SEED=true`,
 * and `server.ts` calls this before listening. apps/api keeps its state in memory until Phase 3, so
 * the seed is loaded at start-up rather than written to a database. The state itself comes from
 * `@nthstock/paperEngine` (`demoSeed.ts`), the same one MSW loads for `?demo=1`.
 */

/** The symbol master as the seed needs it. The demo is built on the mock market's master. */
export function demoInstrumentsOf(market: MarketDataAdapter): DemoInstrument[] {
  if (!(market instanceof MockMarketDataAdapter)) {
    throw new Error('The demo seed needs the mock market (its seeded symbol master)');
  }
  return market.master.equities.map(({ instrument, basePrice }) => ({
    token: instrument.token,
    symbol: instrument.symbol,
    exchange: instrument.exchange,
    name: instrument.name,
    basePrice,
  }));
}

/** Loads the demo watchlists and paper account for the seeded demo user, replacing theirs. */
export async function seedDemo(deps: Pick<AppDeps, 'market' | 'repos' | 'orders'>): Promise<void> {
  const user = await deps.repos.users.findById(DEMO_SEED_USER.id);
  if (user?.mobile !== DEMO_SEED_USER.mobile) {
    throw new Error('The demo seed needs the seeded demo user');
  }
  const instruments = demoInstrumentsOf(deps.market);
  const lists: WatchlistRecord[] = demoWatchlists(instruments).map((list) => ({
    id: list.id,
    userId: DEMO_SEED_USER.id,
    name: list.name,
    items: list.items.map((item) => ({ ...item, addedAt: new Date(item.addedAt) })),
    createdAt: new Date(list.createdAt),
    updatedAt: new Date(list.updatedAt),
  }));
  await deps.repos.watchlists.update(DEMO_SEED_USER.id, () => ({ lists, result: undefined }));
  await deps.orders.restore(DEMO_SEED_USER.id, buildDemoAccount(instruments));
}
