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
import { expect, it } from 'vitest';
import { createPiiCrypto, devPiiKeys } from '../../db/crypto.js';
import { describeRepoConformance } from '../../test/conformance.js';
import { manualClock } from '../../test/manualClock.js';
import { createMemoryAuditRepo, type AuditRepo } from '../audit/index.js';
import { createPgAuditRepo } from '../audit/pgRepo.js';
import {
  createMemoryNotificationsRepo,
  createNotifier,
  createPgNotificationsRepo,
  type NotificationsRepo,
  type StoredNotification,
} from '../notifications/index.js';
import { createPgUsersRepo } from '../users/pgRepo.js';
import { DEMO_USER } from '../users/repo.js';
import { AccountConflict, type AccountStore } from './accountStore.js';
import { createPgAccountStore } from './pgRepo.js';
import { createMemoryAccountStore } from './repo.js';

// Notifications written by the account store inside its commit (NSTOCK-0379): a fill writes one
// notification and one outbox row with the change; a refused or rolled-back commit writes neither,
// and listeners hear only what committed.

const INFY = {
  token: 1594,
  symbol: 'INFY',
  exchange: 'NSE',
  lowerCircuit: 1_200_00,
  upperCircuit: 1_800_00,
} as const;
const clock = manualClock('2026-09-25T04:30:00.000Z');

function newEngine() {
  return new PaperEngine({
    ctx: createEngineContext({
      // Friday 25 Sep 2026, 10:00 IST: the market is open.
      clock: createManualClock(fromIst(2026, 9, 25, 10 * 60)),
      prices: createMapPriceSource([[INFY.token, 1_500_00]]),
      nextId: createSequentialIds('n'),
    }),
    instruments: createMapInstrumentSource([INFY]),
  });
}

const marketBuy = {
  token: INFY.token,
  side: 'BUY',
  type: 'MARKET',
  product: 'DELIVERY',
  qty: 10,
} as const;

/** A repo whose writes succeed and then fail, as a database error after the INSERT would. */
const failingAfterWrite = (repo: NotificationsRepo): NotificationsRepo => ({
  ...repo,
  async appendMany(entries, tx) {
    await repo.appendMany(entries, tx);
    throw new Error('the commit failed after the notifications were written');
  },
});

type Fixture = {
  store: (repo?: NotificationsRepo) => AccountStore;
  repo: NotificationsRepo;
  heard: StoredNotification[];
};

const fixture = (
  repo: NotificationsRepo,
  build: (audit: AuditRepo, notifier: ReturnType<typeof createNotifier>) => AccountStore,
  audit: AuditRepo,
): Fixture => {
  const heard: StoredNotification[] = [];
  return {
    repo,
    heard,
    store: (notifications = repo) => {
      const notifier = createNotifier({ repo: notifications });
      notifier.onCommitted((stored) => heard.push(stored));
      return build(audit, notifier);
    },
  };
};

describeRepoConformance<Fixture>(
  'account store notifications',
  {
    memory: () =>
      fixture(
        createMemoryNotificationsRepo({ clock }),
        (audit, notifier) => createMemoryAccountStore({ audit, notifier }),
        createMemoryAuditRepo({ clock }),
      ),
    postgres: async (database) => {
      const users = createPgUsersRepo({ database, clock, pii: createPiiCrypto(devPiiKeys()) });
      await users.ensureSeeded({ ...DEMO_USER, id: 'usr_a', mobile: '9000000500' });
      return fixture(
        createPgNotificationsRepo({ database, clock }),
        (audit, notifier) => createPgAccountStore({ database, audit, notifier }),
        createPgAuditRepo({ database, clock }),
      );
    },
  },
  ({ repo }) => {
    const filled = () => {
      const engine = newEngine();
      const result = engine.place(marketBuy);
      expect(result.ok && result.order.status).toBe('EXECUTED');
      return engine.workingSet();
    };

    it('writes the fill notification and its outbox row in the commit, then announces it', async () => {
      const { store, repo: notifications, heard } = repo();
      await store().commit('usr_a', { before: null, after: filled() }, 0, []);

      const list = await notifications.list('usr_a');
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({
        kind: 'ORDER_FILLED',
        title: 'Order executed',
        body: 'BUY 10 INFY @ ₹1,500.00',
        symbol: 'INFY',
      });
      expect(await notifications.outboxSize()).toBe(1);
      expect(heard.map((h) => h.notification)).toEqual(list.items);
    });

    it('writes nothing for a commit refused on its version', async () => {
      const { store, repo: notifications, heard } = repo();
      await expect(
        store().commit('usr_a', { before: null, after: filled() }, 3, []),
      ).rejects.toBeInstanceOf(AccountConflict);
      expect(await notifications.list('usr_a')).toEqual({ items: [], unread: 0 });
      expect(await notifications.outboxSize()).toBe(0);
      expect(heard).toEqual([]);
    });

    it('rolls the notification back with a commit that fails after writing it', async () => {
      const { store, repo: notifications, heard } = repo();
      const after: PaperEngineWorkingSet = filled();
      await expect(
        store(failingAfterWrite(notifications)).commit('usr_a', { before: null, after }, 0, []),
      ).rejects.toThrow('the commit failed');
      expect(heard).toEqual([]);
      // The account did not change either, so the same commit can be made again.
      expect(await store().commit('usr_a', { before: null, after }, 0, [])).toBe(1);
    });
  },
);
