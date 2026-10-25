import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import type { PlaceOrderRequest } from '@nthstock/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createDeps, type AppDeps } from '../../deps.js';
import { manualClock, type ManualClock } from '../../test/manualClock.js';
import { createMemoryAuditRepo } from '../audit/index.js';
import { AccountConflict, createMemoryAccountStore, type AccountStore } from '../orders/index.js';
import { createJobs } from './jobs.js';
import { JOB_NAMES } from './definitions.js';
import { safeErrorMessage } from './runner.js';
import { PricesNotLive, runAmoRelease, runDayClose, runSquareOff } from './sessionJobs.js';

/** Friday 25 Sep 2026: 10:00, 15:20 and 15:30 IST, and the evening before Monday's open. */
const MORNING = '2026-09-25T04:30:00.000Z';
const SQUARE_OFF = new Date('2026-09-25T09:50:00.000Z');
const CLOSE = new Date('2026-09-25T10:00:00.000Z');
const EVENING = '2026-09-25T14:30:00.000Z';
const MONDAY_OPEN = new Date('2026-09-28T03:45:00.000Z');

const master = generateSymbolMaster({ equityCount: 60 });
const [first, second] = master.equities.map((equity) => equity.instrument);
if (!first || !second) throw new Error('no equities in the test master');
const noTimers = { setInterval: () => 0, clearInterval: () => undefined };
const USER = 'usr_jobs_test';

const opened: { deps: AppDeps; market: MockMarketDataAdapter }[] = [];

/** One process (the API or the job worker) on the shared account store, as on Postgres. */
function processOn(
  accounts: AccountStore,
  clock: ManualClock,
  onAuditError: (error: Error) => void = () => undefined,
): AppDeps {
  const market = new MockMarketDataAdapter({ master, clock, scheduler: noTimers });
  const deps = createDeps({ clock, market, repos: { accounts }, onAuditError });
  opened.push({ deps, market });
  return deps;
}

afterEach(async () => {
  for (const { deps, market } of opened.splice(0)) {
    await deps.dispose();
    market.dispose();
  }
});

const newStore = (clock: ManualClock) =>
  createMemoryAccountStore({ audit: createMemoryAuditRepo({ clock }) });

const order = (body: Partial<PlaceOrderRequest>): PlaceOrderRequest => ({
  token: first.token,
  side: 'BUY',
  type: 'MARKET',
  product: 'DELIVERY',
  qty: 1,
  validity: 'DAY',
  ...body,
});

async function versionOf(accounts: AccountStore): Promise<number> {
  return (await accounts.load(USER))?.version ?? 0;
}

describe('market-session jobs (T-208)', () => {
  it('squares off intraday at 15:20 and settles delivery at 15:30, once, like T-130', async () => {
    const clock = manualClock(MORNING);
    const accounts = newStore(clock);
    const api = processOn(accounts, clock);
    await api.orders.place(USER, order({ qty: 10 }));
    await api.orders.place(USER, order({ token: second.token, product: 'INTRADAY', qty: 5 }));
    const ltp = api.orders.ltp(first.token) ?? 0;
    await api.orders.place(USER, order({ type: 'LIMIT', price: ltp - 500, product: 'INTRADAY' }));
    await api.orders.flushAudit();

    // The worker is another process: it sees only what the API committed.
    const worker = processOn(accounts, clock);
    const jobDeps = { orders: worker.orders, accounts };

    clock.advance(SQUARE_OFF.getTime() - clock.now().getTime());
    expect(await runSquareOff(SQUARE_OFF, jobDeps)).toEqual({ accounts: 1 });
    const squared = await worker.orders.positions(USER);
    expect(squared.find((p) => p.product === 'INTRADAY')?.netQty).toBe(0);
    const statuses = (await accounts.ordersPage(USER))?.items.map((o) => o.status);
    expect(statuses).toContain('CANCELLED');
    expect(statuses).not.toContain('OPEN');

    clock.advance(CLOSE.getTime() - clock.now().getTime());
    expect(await runDayClose(CLOSE, jobDeps)).toEqual({ accounts: 1 });
    const holdings = await worker.orders.holdings(USER);
    expect(holdings.map((h) => [h.token, h.qty])).toEqual([[first.token, 10]]);

    // A second run, from either process, finds nothing left to do.
    const settled = await versionOf(accounts);
    expect(await runDayClose(CLOSE, jobDeps)).toEqual({ accounts: 1 });
    expect(await versionOf(accounts)).toBe(settled);
    const again = processOn(accounts, clock);
    await runDayClose(CLOSE, { orders: again.orders, accounts });
    expect(await versionOf(accounts)).toBe(settled);
  });

  it('releases AMOs at 09:15 for users who are not online', async () => {
    const clock = manualClock(EVENING);
    const accounts = newStore(clock);
    const api = processOn(accounts, clock);
    const placed = await api.orders.place(USER, order({ qty: 2 }));
    expect(placed.status).toBe('AMO');
    await api.orders.flushAudit();

    const worker = processOn(accounts, clock);
    clock.advance(MONDAY_OPEN.getTime() - clock.now().getTime() + 60_000);
    expect(await runAmoRelease(MONDAY_OPEN, { orders: worker.orders, accounts })).toEqual({
      accounts: 1,
    });
    const page = await accounts.ordersPage(USER);
    expect(page?.items[0]?.status).toBe('EXECUTED');
    expect(await accounts.liveAccountIds()).toEqual([]);
  });

  it('fails the run when an account does not sync, after syncing the others', async () => {
    const clock = manualClock(EVENING);
    const accounts = newStore(clock);
    const api = processOn(accounts, clock);
    await api.orders.place(USER, order({ qty: 2 }));
    await api.orders.flushAudit();
    const broken: AccountStore = {
      ...accounts,
      liveAccountIds: () => Promise.resolve([USER, 'usr_broken']),
      load: (userId) =>
        userId === 'usr_broken'
          ? Promise.reject(new Error('mobile 9876543210 did not decrypt'))
          : accounts.load(userId),
    };
    const reported: Error[] = [];
    const worker = processOn(broken, clock, (error) => reported.push(error));
    clock.advance(MONDAY_OPEN.getTime() - clock.now().getTime() + 60_000);

    expect(await worker.orders.syncAccounts([USER, 'usr_broken'])).toEqual({
      synced: 1,
      failed: 1,
    });
    // The good account got its session event and was committed.
    expect((await accounts.ordersPage(USER))?.items[0]?.status).toBe('EXECUTED');
    // syncAccounts' own report names neither the user nor what the failure said, and what the
    // worker logs of every report (safeErrorMessage) is classes only.
    expect(reported.map((error) => error.message)).toContain('An account did not sync');
    const logged = reported.map((error) => safeErrorMessage(error));
    expect(JSON.stringify(logged)).not.toMatch(/usr_broken|9876543210/);
    await expect(
      runAmoRelease(MONDAY_OPEN, { orders: worker.orders, accounts: broken }),
    ).rejects.toThrow('1 of 2 accounts did not sync');
    expect(await worker.orders.syncAccounts([])).toEqual({ synced: 0, failed: 0 });
  });

  it('syncs again after losing a commit to another writer', async () => {
    const clock = manualClock(EVENING);
    const accounts = newStore(clock);
    const api = processOn(accounts, clock);
    await api.orders.place(USER, order({ qty: 2 }));
    await api.orders.flushAudit();
    let commits = 0;
    const racing: AccountStore = {
      ...accounts,
      commit: (userId, change, expectedVersion, entries) => {
        commits += 1;
        // The first commit loses, as if the API had committed the same event first.
        if (commits === 1) {
          return Promise.reject(new AccountConflict(userId, expectedVersion, expectedVersion + 1));
        }
        return accounts.commit(userId, change, expectedVersion, entries);
      },
    };
    const worker = processOn(racing, clock);
    clock.advance(MONDAY_OPEN.getTime() - clock.now().getTime() + 60_000);
    expect(await worker.orders.syncAccounts([USER])).toEqual({ synced: 1, failed: 0 });
    expect(commits).toBeGreaterThanOrEqual(2);
    expect((await accounts.ordersPage(USER))?.items[0]?.status).toBe('EXECUTED');
  });

  it('waits for live prices before it fills anything', async () => {
    const clock = manualClock(MORNING);
    const accounts = newStore(clock);
    const worker = processOn(accounts, clock);
    const deps = { orders: worker.orders, accounts, pricesLive: () => false };
    await expect(runSquareOff(SQUARE_OFF, deps)).rejects.toBeInstanceOf(PricesNotLive);
    await expect(runDayClose(CLOSE, deps)).rejects.toBeInstanceOf(PricesNotLive);
    await expect(runAmoRelease(MONDAY_OPEN, deps)).rejects.toBeInstanceOf(PricesNotLive);
    expect(await runSquareOff(SQUARE_OFF, { ...deps, pricesLive: () => true })).toEqual({
      accounts: 0,
    });
  });
});

describe('createJobs', () => {
  it('registers every scheduled job', () => {
    const clock = manualClock(MORNING);
    const worker = processOn(newStore(clock), clock);
    const jobs = createJobs({
      orders: worker.orders,
      accounts: worker.repos.accounts,
      pnlSnapshots: worker.repos.pnlSnapshots,
      database: null,
      auth: worker.repos.auth,
      purgeDatabase: null,
    });
    expect(jobs.map((job) => job.name).sort()).toEqual([...JOB_NAMES].sort());
  });
});
