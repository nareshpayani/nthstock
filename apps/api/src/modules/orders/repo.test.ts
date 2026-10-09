import {
  PaperEngine,
  createEngineContext,
  createManualClock,
  createMapInstrumentSource,
  createMapPriceSource,
  createSequentialIds,
  type PaperEngineOptions,
  type PaperEngineWorkingSet,
} from '@nthstock/paperEngine';
import { fromIst } from '@nthstock/utils';
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { createPiiCrypto, devPiiKeys } from '../../db/crypto.js';
import { describeRepoConformance } from '../../test/conformance.js';
import { manualClock } from '../../test/manualClock.js';
import { createMemoryAuditRepo, type AuditRepo, type NewAuditRecord } from '../audit/index.js';
import { createPgAuditRepo } from '../audit/pgRepo.js';
import { createPgUsersRepo } from '../users/pgRepo.js';
import { DEMO_USER } from '../users/repo.js';
import { AccountConflict, type AccountStore } from './accountStore.js';
import { createPgAccountStore } from './pgRepo.js';
import { createMemoryAccountStore } from './repo.js';

// The account store conformance suite (T-202, T-203): the memory store and the Postgres store
// behave the same, and on Postgres a stale commit writes nothing and ledger numbers have no gaps.

const INFY = {
  token: 1594,
  symbol: 'INFY',
  exchange: 'NSE',
  lowerCircuit: 1_200_00,
  upperCircuit: 1_800_00,
} as const;

/** Friday 25 Sep 2026 is a trading day. */
const at = (day: number, hour: number, minute = 0) => fromIst(2026, 9, day, hour * 60 + minute);

/**
 * An engine for one account. Order and ledger ids are unique across users in Postgres (apps/api
 * uses random ids), so each account in a test gets its own prefix.
 */
function newEngine(
  clockAt = at(25, 10),
  idPrefix = 'e',
  carryOn: Pick<PaperEngineOptions, 'snapshot' | 'holdings'> = {},
) {
  const clock = createManualClock(clockAt);
  const engine = new PaperEngine({
    ctx: createEngineContext({
      clock,
      prices: createMapPriceSource([[INFY.token, 1_500_00]]),
      nextId: createSequentialIds(idPrefix),
    }),
    instruments: createMapInstrumentSource([INFY]),
    ...carryOn,
  });
  return { engine, clock };
}

const limitBuy = (price: number) =>
  ({
    token: INFY.token,
    side: 'BUY',
    type: 'LIMIT',
    product: 'DELIVERY',
    qty: 10,
    price,
  }) as const;

const USERS = ['usr_a', 'usr_b'] as const;
const clock = manualClock('2026-09-25T04:30:00.000Z');

const note = (userId: string, orderId: string | null = null): NewAuditRecord => ({
  actor: { type: 'user', userId },
  userId,
  action: 'ORDER_PLACE',
  orderId,
  outcome: 'OK',
  detail: {},
});

type Fixture = { store: AccountStore; audit: AuditRepo };

describeRepoConformance<Fixture>(
  'account store',
  {
    memory: () => {
      const audit = createMemoryAuditRepo({ clock });
      return { store: createMemoryAccountStore({ audit }), audit };
    },
    postgres: async (database) => {
      // Accounts and ledger entries belong to users (foreign key).
      const users = createPgUsersRepo({ database, clock, pii: createPiiCrypto(devPiiKeys()) });
      for (const [index, id] of USERS.entries()) {
        await users.ensureSeeded({ ...DEMO_USER, id, mobile: `900000030${String(index)}` });
      }
      const audit = createPgAuditRepo({ database, clock });
      return { store: createPgAccountStore({ database, audit }), audit };
    },
  },
  ({ driver, repo, database }) => {
    /** Places `count` resting limit orders, committing after each; answers the last working set. */
    async function commitOrders(userId: string, count: number): Promise<PaperEngineWorkingSet> {
      const { engine } = newEngine(at(25, 10), userId);
      let before: PaperEngineWorkingSet | null = null;
      let version = 0;
      for (let i = 0; i < count; i += 1) {
        engine.place(limitBuy(1_400_00 + i * 100));
        const after = engine.workingSet();
        version = await repo().store.commit(userId, { before, after }, version, [note(userId)]);
        before = after;
      }
      return engine.workingSet();
    }

    it('has no account for a user who never committed', async () => {
      const { store } = repo();
      expect(await store.load('usr_a')).toBeNull();
      expect(await store.ordersPage('usr_a')).toEqual({ items: [], nextCursor: null });
      expect(await store.ledgerPage('usr_a')).toEqual({ items: [], nextCursor: null });
      expect(await store.orderHistory('usr_a', 'e1')).toBeNull();
      expect(await store.liveAccountIds()).toEqual([]);
    });

    it('loads what was committed, with a version that counts commits', async () => {
      const { store } = repo();
      const { engine } = newEngine();
      engine.place(limitBuy(1_400_00));
      const first = engine.workingSet();
      expect(await store.commit('usr_a', { before: null, after: first }, 0, [])).toBe(1);
      expect(await store.load('usr_a')).toEqual({ workingSet: first, version: 1 });

      engine.place(limitBuy(1_410_00));
      const second = engine.workingSet();
      expect(await store.commit('usr_a', { before: first, after: second }, 1, [])).toBe(2);
      expect(await store.load('usr_a')).toEqual({ workingSet: second, version: 2 });
    });

    it('hands out copies: changing a loaded working set does not change the account', async () => {
      const { store } = repo();
      await commitOrders('usr_a', 1);
      const loaded = await store.load('usr_a');
      loaded?.workingSet.orders.splice(0);
      expect((await store.load('usr_a'))?.workingSet.orders).toHaveLength(1);
    });

    it('refuses a stale or wrong version with AccountConflict and writes nothing', async () => {
      const { store, audit } = repo();
      const { engine } = newEngine();
      engine.place(limitBuy(1_400_00));
      const first = engine.workingSet();
      await store.commit('usr_a', { before: null, after: first }, 0, [note('usr_a')]);

      engine.place(limitBuy(1_410_00));
      const second = engine.workingSet();
      const stale = store.commit('usr_a', { before: first, after: second }, 0, [note('usr_a')]);
      await expect(stale).rejects.toBeInstanceOf(AccountConflict);
      await expect(stale).rejects.toMatchObject({ expectedVersion: 0, actualVersion: 1 });
      await expect(
        store.commit('usr_b', { before: first, after: second }, 3, [note('usr_b')]),
      ).rejects.toMatchObject({ expectedVersion: 3, actualVersion: 0 });

      expect(await store.load('usr_a')).toEqual({ workingSet: first, version: 1 });
      expect(await store.load('usr_b')).toBeNull();
      expect(await audit.list()).toHaveLength(1);
    });

    it('lets exactly one of two commits at the same version win', async () => {
      const { store } = repo();
      const { engine } = newEngine();
      engine.place(limitBuy(1_400_00));
      const after = engine.workingSet();
      const results = await Promise.allSettled([
        store.commit('usr_a', { before: null, after }, 0, []),
        store.commit('usr_a', { before: null, after }, 0, []),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect((await store.load('usr_a'))?.version).toBe(1);
    });

    it('writes the audit entries with the commit', async () => {
      const { store, audit } = repo();
      await commitOrders('usr_a', 2);
      expect((await audit.list('usr_a')).map((entry) => entry.action)).toEqual([
        'ORDER_PLACE',
        'ORDER_PLACE',
      ]);
      expect(await store.load('usr_a')).toMatchObject({ version: 2 });
    });

    it('commits nothing when the audit entries are refused', async () => {
      const { store, audit } = repo();
      const { engine } = newEngine();
      engine.place(limitBuy(1_400_00));
      const refused = { ...note('usr_a'), detail: { mobile: '9999999999' } };
      await expect(
        store.commit('usr_a', { before: null, after: engine.workingSet() }, 0, [refused]),
      ).rejects.toThrow();
      expect(await store.load('usr_a')).toBeNull();
      expect(await audit.list()).toEqual([]);
    });

    it('pages orders newest first with the id of the last order as the cursor', async () => {
      const { store } = repo();
      await commitOrders('usr_a', 3);
      const first = await store.ordersPage('usr_a', { limit: 2 });
      expect(first?.items.map((o) => o.price)).toEqual([1_402_00, 1_401_00]);
      expect(first?.nextCursor).toBe(first?.items.at(-1)?.id);
      const second = await store.ordersPage('usr_a', { limit: 2, cursor: first?.nextCursor ?? '' });
      expect(second?.items.map((o) => o.price)).toEqual([1_400_00]);
      expect(second?.nextCursor).toBeNull();
      expect(await store.ordersPage('usr_a', { cursor: 'nope' })).toBeNull();
    });

    it('filters the order book by status and keeps users apart', async () => {
      const { store } = repo();
      await commitOrders('usr_a', 2);
      const { engine } = newEngine(at(25, 10), 'b');
      const placed = engine.place(limitBuy(1_400_00));
      const orderId = placed.order?.id ?? '';
      engine.cancel(orderId);
      await store.commit('usr_b', { before: null, after: engine.workingSet() }, 0, []);

      expect((await store.ordersPage('usr_a', { status: 'OPEN' }))?.items).toHaveLength(2);
      expect((await store.ordersPage('usr_a', { status: 'CANCELLED' }))?.items).toEqual([]);
      expect((await store.ordersPage('usr_b', { status: 'CANCELLED' }))?.items).toHaveLength(1);
      expect(await store.orderHistory('usr_a', orderId)).toBeNull();
      expect((await store.orderHistory('usr_b', orderId))?.items.map((e) => e.event)).toEqual([
        'PLACED',
        'CANCELLED',
      ]);
    });

    it('keeps the latest state of an order and its history across commits', async () => {
      const { store } = repo();
      const { engine } = newEngine();
      const id = engine.place(limitBuy(1_400_00)).order?.id ?? '';
      const first = engine.workingSet();
      await store.commit('usr_a', { before: null, after: first }, 0, []);
      engine.cancel(id);
      await store.commit('usr_a', { before: first, after: engine.workingSet() }, 1, []);

      const page = await store.ordersPage('usr_a');
      expect(page?.items).toHaveLength(1);
      expect(page?.items[0]?.status).toBe('CANCELLED');
      expect((await store.orderHistory('usr_a', id))?.items.map((e) => e.event)).toEqual([
        'PLACED',
        'CANCELLED',
      ]);
    });

    it('pages the funds ledger newest first, without repeating entries across commits', async () => {
      const { store } = repo();
      const { engine } = newEngine();
      const id = engine.place(limitBuy(1_400_00)).order?.id ?? '';
      const first = engine.workingSet();
      await store.commit('usr_a', { before: null, after: first }, 0, []);
      engine.cancel(id);
      await store.commit('usr_a', { before: first, after: engine.workingSet() }, 1, []);

      const all = await store.ledgerPage('usr_a');
      const expected = [...engine.ledger.entries()].reverse().map((e) => e.id);
      expect(all?.items.map((e) => e.id)).toEqual(expected);
      expect(expected.length).toBeGreaterThanOrEqual(3);
      const one = await store.ledgerPage('usr_a', { limit: 1 });
      expect(one?.items.map((e) => e.id)).toEqual([expected[0]]);
      const rest = await store.ledgerPage('usr_a', { cursor: one?.nextCursor ?? '' });
      expect(rest?.items.map((e) => e.id)).toEqual(expected.slice(1));
      expect(await store.ledgerPage('usr_a', { cursor: 'nope' })).toBeNull();
    });

    it('lists the accounts with an AMO or OPEN order', async () => {
      const { store } = repo();
      await commitOrders('usr_a', 1);
      const { engine } = newEngine(at(25, 10), 'b');
      const id = engine.place(limitBuy(1_400_00)).order?.id ?? '';
      const open = engine.workingSet();
      await store.commit('usr_b', { before: null, after: open }, 0, []);
      expect((await store.liveAccountIds()).sort()).toEqual(['usr_a', 'usr_b']);

      engine.cancel(id);
      await store.commit('usr_b', { before: open, after: engine.workingSet() }, 1, []);
      expect(await store.liveAccountIds()).toEqual(['usr_a']);
    });

    it('lists the accounts touched on an IST trade date', async () => {
      const { store } = repo();
      await commitOrders('usr_a', 1);
      const later = newEngine(at(28, 10), 'later');
      later.engine.place(limitBuy(1_400_00));
      await store.commit('usr_b', { before: null, after: later.engine.workingSet() }, 0, []);

      expect(await store.accountsTouchedOn('2026-09-25')).toEqual(['usr_a']);
      expect(await store.accountsTouchedOn('2026-09-28')).toEqual(['usr_b']);
      expect(await store.accountsTouchedOn('2026-09-26')).toEqual([]);
    });

    it('round-trips positions, holdings, holding sales and the funds ledger', async () => {
      const { store } = repo();
      const holding = [[INFY.token, { qty: 20, investedValue: 20 * 1_400_00 }]] as const;
      const { engine } = newEngine(at(25, 10), 'e', { holdings: holding });
      const market = { token: INFY.token, type: 'MARKET' } as const;
      expect(engine.place({ ...market, side: 'BUY', product: 'INTRADAY', qty: 10 }).ok).toBe(true);
      expect(engine.place({ ...market, side: 'SELL', product: 'DELIVERY', qty: 5 }).ok).toBe(true);
      // Positions come back in key order; the engine lists them in the order they were opened.
      const byKey = (set: PaperEngineWorkingSet): PaperEngineWorkingSet => ({
        ...set,
        positions: set.positions.toSorted((a, b) => a.product.localeCompare(b.product)),
      });
      const first = engine.workingSet();
      expect(first.positions).toHaveLength(2);
      expect(first.holdingSales).toHaveLength(1);
      await store.commit('usr_a', { before: null, after: first }, 0, []);
      const loadedFirst = await store.load('usr_a');
      expect(loadedFirst && { ...loadedFirst, workingSet: byKey(loadedFirst.workingSet) }).toEqual({
        workingSet: byKey(first),
        version: 1,
      });

      // Selling the rest drops the holding row; the position and sale rows are replaced.
      engine.place({ ...market, side: 'SELL', product: 'DELIVERY', qty: 15 });
      const second = engine.workingSet();
      expect(second.holdings).toEqual([]);
      await store.commit('usr_a', { before: first, after: second }, 1, []);
      const loadedSecond = await store.load('usr_a');
      expect(loadedSecond?.version).toBe(2);
      expect(loadedSecond && byKey(loadedSecond.workingSet)).toEqual(byKey(second));
    });

    it('carries the balance and the blocks of earlier days into the working set', async () => {
      const { store } = repo();
      // Friday 20:00 IST: the market is closed, so the order is an AMO with cash blocked.
      const evening = newEngine(at(25, 20), 'e');
      evening.engine.place(limitBuy(1_400_00));
      const first = evening.engine.workingSet();
      await store.commit('usr_a', { before: null, after: first }, 0, []);

      // Saturday: the AMO is still waiting, and Friday's entries are no longer today's.
      const saturday = newEngine(at(26, 10), 'f', { snapshot: first });
      saturday.engine.sync();
      const second = saturday.engine.workingSet();
      expect(second.ledger.entries).toEqual([]);
      expect(second.ledger.carried.blocks).toHaveLength(1);
      await store.commit('usr_a', { before: first, after: second }, 1, []);
      expect(await store.load('usr_a')).toEqual({ workingSet: second, version: 2 });
      // The older entries are still in the ledger.
      expect((await store.ledgerPage('usr_a'))?.items).toHaveLength(first.ledger.entries.length);
    });

    if (driver === 'memory') {
      it('forgets every account on reset', async () => {
        const { store } = repo();
        await commitOrders('usr_a', 1);
        await store.reset();
        expect(await store.load('usr_a')).toBeNull();
        expect(await store.liveAccountIds()).toEqual([]);
      });
    }

    if (driver === 'postgres') {
      it('refuses to reset: the ledger is append-only for the app role', async () => {
        await expect(repo().store.reset()).rejects.toThrow(/append-only/);
      });

      it('writes nothing for a stale commit, not even to the tables below the account', async () => {
        const { store } = repo();
        const final = await commitOrders('usr_a', 1);
        const counts = () =>
          database().db.execute<{ orders: number; events: number; ledger: number }>(sql`
            select (select count(*)::int from orders) as orders,
                   (select count(*)::int from order_events) as events,
                   (select count(*)::int from ledger_entries) as ledger`);
        const before = (await counts()).rows;

        const { engine } = newEngine(at(25, 10), 'stale', { snapshot: final });
        engine.place(limitBuy(1_450_00));
        await expect(
          store.commit('usr_a', { before: final, after: engine.workingSet() }, 0, [note('usr_a')]),
        ).rejects.toBeInstanceOf(AccountConflict);
        expect((await counts()).rows).toEqual(before);
      });

      it('numbers a user’s ledger entries 1..n with no gaps under concurrent commits', async () => {
        const { store } = repo();
        const workers = 12;
        const first = newEngine(at(25, 10), 'w');
        const opened = first.engine.workingSet();
        await store.commit('usr_a', { before: null, after: opened }, 0, []);

        // Each worker reads the account, places an order and commits, rereading after a conflict.
        const place = async (worker: number) => {
          for (;;) {
            const loaded = await store.load('usr_a');
            if (!loaded) throw new Error('account vanished');
            const { engine } = newEngine(at(25, 10), `w${String(worker)}-`, {
              snapshot: loaded.workingSet,
            });
            engine.place(limitBuy(1_400_00 + worker * 100));
            try {
              return await store.commit(
                'usr_a',
                { before: loaded.workingSet, after: engine.workingSet() },
                loaded.version,
                [],
              );
            } catch (error) {
              if (!(error instanceof AccountConflict)) throw error;
            }
          }
        };
        const versions = await Promise.all(Array.from({ length: workers }, (_, i) => place(i)));
        expect(versions.sort((a, b) => a - b)).toEqual(
          Array.from({ length: workers }, (_, i) => i + 2),
        );

        const { rows } = await database().db.execute<{ seq: number }>(
          sql`select seq::int as seq from ledger_entries where user_id = 'usr_a' order by seq`,
        );
        // The opening credit plus one block per order.
        expect(rows.map((row) => row.seq)).toEqual(
          Array.from({ length: workers + 1 }, (_, i) => i + 1),
        );
        expect((await store.ordersPage('usr_a', { limit: 100 }))?.items).toHaveLength(workers);
      });
    }
  },
);
