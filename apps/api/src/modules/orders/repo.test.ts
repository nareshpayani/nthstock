import {
  PaperEngine,
  createEngineContext,
  createManualClock,
  createMapInstrumentSource,
  createMapPriceSource,
  createSequentialIds,
  type PaperEngineWorkingSet,
} from '@nthstock/paperEngine';
import { fromIst } from '@nthstock/utils';
import { describe, expect, it } from 'vitest';
import { describeRepoConformance } from '../../test/conformance.js';
import { manualClock } from '../../test/manualClock.js';
import { createMemoryAuditRepo, type AuditRepo, type NewAuditRecord } from '../audit/index.js';
import { AccountConflict, type AccountStore } from './accountStore.js';
import { createMemoryAccountStore } from './repo.js';

// The account store conformance suite (T-202): every implementation of AccountStore passes it.
// The Postgres store joins in T-203.

const INFY = {
  token: 1594,
  symbol: 'INFY',
  exchange: 'NSE',
  lowerCircuit: 1_200_00,
  upperCircuit: 1_800_00,
} as const;

/** Friday 25 Sep 2026 is a trading day. */
const at = (day: number, hour: number, minute = 0) => fromIst(2026, 9, day, hour * 60 + minute);

function newEngine(clockAt = at(25, 10), idPrefix = 'e') {
  const clock = createManualClock(clockAt);
  const engine = new PaperEngine({
    ctx: createEngineContext({
      clock,
      prices: createMapPriceSource([[INFY.token, 1_500_00]]),
      nextId: createSequentialIds(idPrefix),
    }),
    instruments: createMapInstrumentSource([INFY]),
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
      const audit = createMemoryAuditRepo({ clock: manualClock('2026-09-25T04:30:00.000Z') });
      return { store: createMemoryAccountStore({ audit }), audit };
    },
  },
  ({ repo }) => {
    /** Places `count` resting limit orders, committing after each; answers the last working set. */
    async function commitOrders(userId: string, count: number): Promise<PaperEngineWorkingSet> {
      const { engine } = newEngine();
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
      const { engine } = newEngine();
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
      const later = newEngine(at(28, 10));
      later.engine.place(limitBuy(1_400_00));
      await store.commit('usr_b', { before: null, after: later.engine.workingSet() }, 0, []);

      expect(await store.accountsTouchedOn('2026-09-25')).toEqual(['usr_a']);
      expect(await store.accountsTouchedOn('2026-09-28')).toEqual(['usr_b']);
      expect(await store.accountsTouchedOn('2026-09-26')).toEqual([]);
    });

    describe('reset', () => {
      it('forgets every account', async () => {
        const { store } = repo();
        await commitOrders('usr_a', 1);
        await store.reset();
        expect(await store.load('usr_a')).toBeNull();
        expect(await store.liveAccountIds()).toEqual([]);
      });
    });
  },
);
