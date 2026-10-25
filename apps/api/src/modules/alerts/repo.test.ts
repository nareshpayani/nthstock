import type { PriceAlert } from '@nthstock/contracts';
import { expect, it } from 'vitest';
import { createPiiCrypto, devPiiKeys } from '../../db/crypto.js';
import { describeRepoConformance } from '../../test/conformance.js';
import { manualClock } from '../../test/manualClock.js';
import {
  createMemoryNotificationsRepo,
  createPgNotificationsRepo,
  type NotificationsRepo,
} from '../notifications/index.js';
import { createPgUsersRepo } from '../users/pgRepo.js';
import { DEMO_USER } from '../users/repo.js';
import { createPgAlertsRepo } from './pgRepo.js';
import { ENDED_ALERTS_LISTED, createMemoryAlertsRepo, type AlertsRepo } from './repo.js';
import { alertNotification } from './service.js';

// The price alerts store conformance suite (NSTOCK-0383): memory and Postgres keep alerts the same
// way, and an alert fires exactly once, with its notification, however many firings race.

const clock = manualClock('2026-10-25T04:30:00.000Z');
const USERS = ['usr_a', 'usr_b'] as const;

const alert = (id: string, createdAt = '2026-10-25T04:30:00.000Z'): PriceAlert => ({
  id,
  token: 1594,
  symbol: 'INFY',
  exchange: 'NSE',
  condition: 'ABOVE',
  price: 1_530_00,
  note: 'take profit',
  status: 'ACTIVE',
  createdAt,
  createdLtp: 1_500_00,
  triggeredAt: null,
  triggeredLtp: null,
});

type Fixture = { alerts: AlertsRepo; notifications: NotificationsRepo };

describeRepoConformance<Fixture>(
  'price alerts repo',
  {
    memory: () => {
      const notifications = createMemoryNotificationsRepo({ clock });
      return { alerts: createMemoryAlertsRepo({ notifications }), notifications };
    },
    postgres: async (database) => {
      const users = createPgUsersRepo({ database, clock, pii: createPiiCrypto(devPiiKeys()) });
      for (const [index, id] of USERS.entries()) {
        await users.ensureSeeded({ ...DEMO_USER, id, mobile: `900000060${String(index)}` });
      }
      const notifications = createPgNotificationsRepo({ database, clock });
      return { alerts: createPgAlertsRepo({ database, notifications }), notifications };
    },
  },
  ({ repo }) => {
    it('lists active alerts newest first, then the latest ended ones', async () => {
      const { alerts } = repo();
      await alerts.insert('usr_a', alert('al_old', '2026-10-25T04:00:00.000Z'));
      await alerts.insert('usr_a', alert('al_new', '2026-10-25T04:10:00.000Z'));
      for (let i = 0; i < ENDED_ALERTS_LISTED + 2; i += 1) {
        const id = `al_end${String(i).padStart(2, '0')}`;
        await alerts.insert('usr_a', alert(id, `2026-10-25T03:${String(10 + i)}:00.000Z`));
        await alerts.cancel('usr_a', id);
      }
      await alerts.insert('usr_b', alert('al_b'));

      const list = await alerts.list('usr_a');
      expect(list.slice(0, 2).map((a) => a.id)).toEqual(['al_new', 'al_old']);
      expect(list).toHaveLength(2 + ENDED_ALERTS_LISTED);
      expect(list[2]?.id).toBe(`al_end${String(ENDED_ALERTS_LISTED + 1)}`);
      expect(await alerts.countActive('usr_a')).toBe(2);
      expect(list[0]).toEqual(alert('al_new', '2026-10-25T04:10:00.000Z'));
    });

    it("cancels an active alert of the user's own only", async () => {
      const { alerts } = repo();
      await alerts.insert('usr_a', alert('al_1'));
      expect(await alerts.cancel('usr_b', 'al_1')).toBe('NOT_FOUND');
      expect(await alerts.cancel('usr_a', 'al_1')).toMatchObject({ status: 'CANCELLED' });
      expect(await alerts.cancel('usr_a', 'al_1')).toBe('INVALID_STATE');
      expect(await alerts.active()).toEqual([]);
    });

    it('fires an alert exactly once, with one notification, when firings race', async () => {
      const { alerts, notifications } = repo();
      await alerts.insert('usr_a', alert('al_1'));
      expect(await alerts.active()).toEqual([{ userId: 'usr_a', alert: alert('al_1') }]);

      const at = new Date('2026-10-25T04:31:00.000Z');
      const results = await Promise.all(
        Array.from({ length: 5 }, () => alerts.fire('al_1', 1_531_00, at, alertNotification)),
      );
      const won = results.filter((result) => result !== null);
      expect(won).toHaveLength(1);
      expect(won[0]).toMatchObject({
        userId: 'usr_a',
        alert: { status: 'TRIGGERED', triggeredLtp: 1_531_00, triggeredAt: at.toISOString() },
        stored: {
          notification: {
            kind: 'PRICE_ALERT',
            title: 'INFY crossed above ₹1,530.00',
            body: 'Now ₹1,531.00 · take profit',
          },
        },
      });
      expect((await notifications.list('usr_a')).items).toHaveLength(1);
      expect(await notifications.outboxSize()).toBe(1);
      expect(await alerts.fire('al_1', 1_540_00, at, alertNotification)).toBeNull();
      expect(await alerts.active()).toEqual([]);
    });

    it('does not fire a cancelled alert', async () => {
      const { alerts } = repo();
      await alerts.insert('usr_a', alert('al_1'));
      await alerts.cancel('usr_a', 'al_1');
      expect(await alerts.fire('al_1', 1_531_00, new Date(), alertNotification)).toBeNull();
    });
  },
);
