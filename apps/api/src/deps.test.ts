import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { fixedClock, systemClock } from '@nthstock/utils';
import { describe, expect, it, vi } from 'vitest';
import { createDatabase } from './db/client.js';
import { createDeps, resetRepos } from './deps.js';
import { DEMO_USER, createMemoryUsersRepo } from './modules/users/repo.js';

const silent = { info: () => undefined, warn: () => undefined };

describe('createDeps', () => {
  it('defaults to the system clock and fresh in-memory repos', async () => {
    const a = createDeps();
    const b = createDeps();

    expect(a.clock).toBe(systemClock);
    await a.repos.users.create({ mobile: '9876543210' });
    expect(await b.repos.users.findByMobile('9876543210')).toBeNull();
    await a.dispose();
    await b.dispose();
  });

  it('takes an injected clock and repos', async () => {
    const clock = fixedClock('2026-09-25T04:00:00.000Z');
    const users = createMemoryUsersRepo({ clock });

    const deps = createDeps({ clock, repos: { users } });
    await deps.dispose();

    expect(deps.clock).toBe(clock);
    expect(deps.repos.users).toBe(users);
  });

  it('resets every repo to its seed', async () => {
    const { repos, dispose } = createDeps();
    await repos.users.create({ mobile: '9876543210' });
    await repos.users.update(DEMO_USER.id, { pinSet: true });

    await resetRepos(repos);

    expect(await repos.users.findByMobile('9876543210')).toBeNull();
    expect(await repos.users.findById(DEMO_USER.id)).toEqual(DEMO_USER);
    await dispose();
  });

  it('uses no database on the default memory driver (T-182)', async () => {
    const deps = createDeps();

    expect(deps.dbDriver).toBe('memory');
    expect(deps.database).toBeNull();
    await deps.dispose();
  });

  it('opens a Postgres pool for DB_DRIVER=postgres and closes it on dispose', async () => {
    const deps = createDeps({
      dbDriver: 'postgres',
      databaseUrl: 'postgres://nthstock_app:x@127.0.0.1:1/nthstock',
      pgPoolMax: 3,
    });
    const database = deps.database;

    expect(deps.dbDriver).toBe('postgres');
    expect(database).not.toBeNull();
    const close = vi.spyOn(database as NonNullable<typeof database>, 'close');
    await deps.dispose();
    expect(close).toHaveBeenCalledOnce();
  });

  it('leaves an injected database open', async () => {
    const database = createDatabase({ url: 'postgres://nthstock_app:x@127.0.0.1:1/nthstock' });
    const close = vi.spyOn(database, 'close');

    const deps = createDeps({ database });
    await deps.dispose();

    expect(deps.dbDriver).toBe('postgres');
    expect(deps.database).toBe(database);
    expect(close).not.toHaveBeenCalled();
    await database.close();
  });

  it('refuses DB_DRIVER=postgres without a URL', () => {
    expect(() => createDeps({ dbDriver: 'postgres' })).toThrow(/needs a DATABASE_URL/);
  });

  it('matches inline by default, and refuses MATCHER_MODE=worker without the quote streams', async () => {
    const deps = createDeps();
    expect(deps.matcherMode).toBe('inline');
    await deps.dispose();
    expect(() => createDeps({ matcherMode: 'worker' })).toThrow(/MATCHER_MODE=worker needs/);
  });

  it('never subscribes the desk to the adapter under MATCHER_MODE=worker (NSTOCK-0388)', async () => {
    const master = generateSymbolMaster({ equityCount: 20 });
    const equity = master.equities[0]?.instrument;
    const run = async (matcherMode: 'inline' | 'worker') => {
      const market = new MockMarketDataAdapter({
        master,
        clock: fixedClock('2026-09-28T04:30:00.000Z'), // Monday 10:00 IST, market open
        externalTicks: true,
        scheduler: { setInterval: () => 0, clearInterval: () => undefined },
      });
      const subscribe = vi.spyOn(market, 'subscribe');
      const quote = await market.getQuote(equity?.symbol ?? '');
      // Redis is unreachable on purpose: nothing here waits on it.
      const deps = createDeps({
        market,
        clock: fixedClock('2026-09-28T04:30:00.000Z'),
        matcherMode,
        quoteStreams: { url: 'redis://127.0.0.1:1', shards: 1, log: silent, blockMs: 10 },
      });
      try {
        // A LIMIT 3% under the quote rests, which inline would follow ticks for.
        const placed = await deps.orders.place('usr_worker', {
          token: equity?.token ?? 0,
          side: 'BUY',
          type: 'LIMIT',
          product: 'DELIVERY',
          qty: 1,
          price: Math.floor(((quote?.ltp ?? 0) * 0.97) / 5) * 5,
        });
        expect(placed.status).toBe('OPEN');
        await deps.orders.positions('usr_worker');
        return subscribe.mock.calls.length;
      } finally {
        await deps.dispose();
        market.dispose();
      }
    };
    expect(await run('worker')).toBe(0);
    // The inline counterpart does subscribe, so the check above can fail.
    expect(await run('inline')).toBeGreaterThan(0);
  }, 20_000);
});
