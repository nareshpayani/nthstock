import { NOTIFICATIONS_KEPT } from '@nthstock/contracts';
import { expect, it } from 'vitest';
import { createPiiCrypto, devPiiKeys } from '../../db/crypto.js';
import { describeRepoConformance } from '../../test/conformance.js';
import { manualClock } from '../../test/manualClock.js';
import { createPgUsersRepo } from '../users/pgRepo.js';
import { DEMO_USER } from '../users/repo.js';
import { createPgNotificationsRepo } from './pgRepo.js';
import { createMemoryNotificationsRepo } from './repo.js';
import type { NewNotification } from './schema.js';

// The notifications repo conformance suite (NSTOCK-0379): the memory and Postgres repos keep the
// same centre and outbox.

const USERS = ['usr_a', 'usr_b'] as const;
const clock = manualClock('2026-10-25T04:30:00.000Z');

const note = (userId: string, title = 'Order executed'): NewNotification => ({
  userId,
  kind: 'ORDER_FILLED',
  refId: 'ord_1',
  title,
  body: 'BUY 10 INFY @ ₹1,530.00',
  symbol: 'INFY',
  exchange: 'NSE',
});

describeRepoConformance(
  'notifications repo',
  {
    memory: () => createMemoryNotificationsRepo({ clock }),
    postgres: async (database) => {
      // Notifications belong to users (foreign key).
      const users = createPgUsersRepo({ database, clock, pii: createPiiCrypto(devPiiKeys()) });
      for (const [index, id] of USERS.entries()) {
        await users.ensureSeeded({ ...DEMO_USER, id, mobile: `900000040${String(index)}` });
      }
      return createPgNotificationsRepo({ database, clock });
    },
  },
  ({ repo }) => {
    it('stores notifications newest first, unread, with ids that grow', async () => {
      const stored = await repo().appendMany([note('usr_a', 'first'), note('usr_a', 'second')]);
      expect(stored.map((s) => s.notification.title)).toEqual(['first', 'second']);
      const [first, second] = stored.map((s) => Number(s.notification.id));
      expect(second).toBeGreaterThan(first ?? 0);

      const list = await repo().list('usr_a');
      expect(list.unread).toBe(2);
      expect(list.items.map((item) => item.title)).toEqual(['second', 'first']);
      expect(list.items[0]).toEqual({
        id: stored[1]?.notification.id,
        kind: 'ORDER_FILLED',
        title: 'second',
        body: 'BUY 10 INFY @ ₹1,530.00',
        symbol: 'INFY',
        exchange: 'NSE',
        at: '2026-10-25T04:30:00.000Z',
        read: false,
      });
      expect(await repo().list('usr_b')).toEqual({ items: [], unread: 0 });
    });

    it('passes the alert through without storing it', async () => {
      const alert = { id: 'al_1' } as NonNullable<NewNotification['alert']>;
      const [stored] = await repo().appendMany([{ ...note('usr_a'), alert }]);
      expect(stored?.alert).toBe(alert);
      const [pending] = await repo().pendingOutbox(new Date('2027-01-01'), 10);
      expect(pending).toEqual({ userId: 'usr_a', notification: stored?.notification });
    });

    it('marks the given notifications read, or all, for their user only', async () => {
      const [a1, a2] = await repo().appendMany([note('usr_a'), note('usr_a')]);
      await repo().appendMany([note('usr_b')]);

      const some = await repo().markRead('usr_a', [a1?.notification.id ?? '', 'not-a-row']);
      expect(some.unread).toBe(1);
      expect(some.items.find((i) => i.id === a1?.notification.id)?.read).toBe(true);
      expect(some.items.find((i) => i.id === a2?.notification.id)?.read).toBe(false);

      expect((await repo().markRead('usr_a')).unread).toBe(0);
      expect((await repo().list('usr_b')).unread).toBe(1);
    });

    it(`keeps the newest ${String(NOTIFICATIONS_KEPT)} per user, and their outbox rows`, async () => {
      const many = Array.from({ length: NOTIFICATIONS_KEPT + 5 }, (_, i) =>
        note('usr_a', `n${String(i)}`),
      );
      await repo().appendMany(many.slice(0, 50));
      await repo().appendMany(many.slice(50));
      await repo().appendMany([note('usr_b')]);

      const list = await repo().list('usr_a');
      expect(list.items).toHaveLength(NOTIFICATIONS_KEPT);
      expect(list.items[0]?.title).toBe(`n${String(NOTIFICATIONS_KEPT + 4)}`);
      expect(list.items.at(-1)?.title).toBe('n5');
      expect(await repo().outboxSize()).toBe(NOTIFICATIONS_KEPT + 1);
    });

    it('hands out outbox rows older than a time, oldest first, until cleared', async () => {
      const stored = await repo().appendMany([note('usr_a', 'a'), note('usr_b', 'b')]);
      expect(await repo().pendingOutbox(new Date('2026-10-25T04:30:00.000Z'), 10)).toEqual([]);

      const later = new Date('2026-10-25T04:30:05.001Z');
      expect((await repo().pendingOutbox(later, 10)).map((p) => p.userId)).toEqual([
        'usr_a',
        'usr_b',
      ]);
      expect(await repo().pendingOutbox(later, 1)).toHaveLength(1);

      await repo().clearOutbox([stored[0]?.notification.id ?? '', 'x']);
      expect((await repo().pendingOutbox(later, 10)).map((p) => p.userId)).toEqual(['usr_b']);
      expect(await repo().outboxSize()).toBe(1);
      await repo().clearOutbox([]);
      expect(await repo().outboxSize()).toBe(1);
    });
  },
);
