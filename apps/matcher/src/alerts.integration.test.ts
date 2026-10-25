import { NOTIFICATIONS_KEPT, NotificationEvent, type Quote } from '@nthstock/contracts';
import type { TickStreamClient } from '@nthstock/marketData';
import { shardOf } from '@nthstock/utils';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createPgAlertStore, startAlertDesk, type AlertDesk } from './alerts.js';
import { startMatcher } from './matcher.js';
import { describeWithPostgres, startTestPostgres } from './test/testPostgres.js';
import { quote } from './test/quotes.js';
import { describeWithRedis, startTestRedis, type TestRedis } from './test/testRedis.js';

// NSTOCK-0383 acceptance: an alert on the matcher's book fires once, is stored as TRIGGERED with
// its notification in the tables apps/api reads, and reaches the user's notify channel.

const SHARDS = 2;
const SHARD = 0;
const [TOKEN = 0] = Array.from({ length: 20 }, (_, i) => i + 1).filter(
  (t) => shardOf(t, SHARDS) === SHARD,
);
const silent = { info: () => undefined, warn: () => undefined };
const AT = '2026-09-28T04:30:00.000Z';

describeWithPostgres('matcher price alerts (integration, NSTOCK-0383)', () => {
  describeWithRedis('with Redis', () => {
    let redisServer: TestRedis | undefined;
    let redis: Redis;
    let subscriber: Redis;
    let owner: Pool;
    let app: Pool;

    beforeAll(async () => {
      const pg = await startTestPostgres();
      owner = new Pool({ connectionString: pg.ownerUrl, max: 2 });
      app = new Pool({ connectionString: pg.appUrl, max: 4 });
      redisServer = await startTestRedis();
      redis = new Redis(redisServer.url);
      subscriber = new Redis(redisServer.url);
    }, 180_000);

    afterAll(async () => {
      await app.end();
      await owner.end();
      redis.disconnect();
      subscriber.disconnect();
      await redisServer?.stop();
    });

    async function seedUser(userId: string) {
      // Placeholder bytes stand in for the encrypted mobile: the matcher never reads them.
      await owner.query(
        `INSERT INTO users (id, mobile_enc, mobile_hash, mobile_last4, created_at, updated_at)
         VALUES ($1, '\\x00', sha256(convert_to($1, 'UTF8')), '0001', $2, $2)`,
        [userId, AT],
      );
    }
    async function seedAlert(userId: string, id: string, price: number) {
      await owner.query(
        `INSERT INTO price_alerts (id, user_id, token, symbol, exchange, condition, price, note,
           status, created_at, created_ltp)
         VALUES ($1, $2, $3, 'INFY', 'NSE', 'ABOVE', $4, 'Breakout', 'ACTIVE', $5, $6)`,
        [id, userId, TOKEN, price, AT, price - 1_00],
      );
    }

    it('fires an alert once from a tick, stores it and publishes it', async () => {
      await seedUser('u-alert');
      await seedAlert('u-alert', 'al-1', 1_530_00);
      const received: NotificationEvent[] = [];
      await subscriber.subscribe('nthstock:notify:v1:u-alert');
      subscriber.on('message', (_channel: string, message: string) => {
        received.push(NotificationEvent.parse(JSON.parse(message)));
      });

      let push: (quotes: readonly Quote[]) => void = () => undefined;
      const late: { desk?: AlertDesk } = {};
      const matcher = startMatcher({
        client: {} as TickStreamClient,
        shard: SHARD,
        holdsLease: () => true,
        alwaysOpen: true,
        onTick: () => undefined,
        onAlerts: (fired) => late.desk?.onAlerts(fired),
        log: silent,
        follow: (options) => {
          push = options.onQuotes;
          return { ready: () => Promise.resolve(), close: () => Promise.resolve() };
        },
      });
      const desk = startAlertDesk({
        store: createPgAlertStore(app),
        publisher: redis,
        shard: SHARD,
        shards: SHARDS,
        books: matcher.books,
        book: matcher.book,
        log: silent,
        timer: null,
      });
      late.desk = desk;
      try {
        await Promise.all([matcher.ready(), desk.ready()]);
        expect(matcher.book(TOKEN).hasAlert('al-1')).toBe(true);

        push([quote(TOKEN, 1_529_95)]);
        push([quote(TOKEN, 1_531_20), quote(TOKEN, 1_532_00)]);
        await desk.settled();
        await vi.waitFor(() => expect(received).toHaveLength(1));

        const [event] = received;
        expect(event?.notification).toMatchObject({
          kind: 'PRICE_ALERT',
          title: 'INFY crossed above ₹1,530.00',
          body: 'Now ₹1,531.20 · Breakout',
          read: false,
        });
        expect(event?.alert).toMatchObject({
          id: 'al-1',
          status: 'TRIGGERED',
          triggeredLtp: 1_531_20,
        });
        const alert = await owner.query<{ status: string; triggered_ltp: string }>(
          'SELECT status, triggered_ltp FROM price_alerts WHERE id = $1',
          ['al-1'],
        );
        expect(alert.rows).toEqual([{ status: 'TRIGGERED', triggered_ltp: '153120' }]);
        const stored = await owner.query<{ id: string; ref_id: string }>(
          'SELECT id::text, ref_id FROM notifications WHERE user_id = $1',
          ['u-alert'],
        );
        expect(stored.rows).toEqual([{ id: event?.notification.id, ref_id: 'al-1' }]);
        // Published, so apps/api's relay has nothing to resend.
        const outbox = await owner.query('SELECT 1 FROM notification_outbox WHERE user_id = $1', [
          'u-alert',
        ]);
        expect(outbox.rowCount).toBe(0);
        // The next reload does not put a TRIGGERED alert back.
        expect(await desk.reload()).toEqual({ added: 0, removed: 0 });
        expect(matcher.book(TOKEN).hasAlert('al-1')).toBe(false);
      } finally {
        await desk.stop();
        await matcher.close();
        await subscriber.unsubscribe();
      }
    });

    it('stores one notification when several firings race, as apps/api and the matcher may', async () => {
      await seedUser('u-race');
      await seedAlert('u-race', 'al-race', 1_000_00);
      const store = createPgAlertStore(app);
      const at = new Date('2026-09-28T05:00:00.000Z');
      const results = await Promise.all(
        Array.from({ length: 4 }, () => store.fire('al-race', 1_001_00, at)),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      const stored = await owner.query('SELECT 1 FROM notifications WHERE user_id = $1', [
        'u-race',
      ]);
      expect(stored.rowCount).toBe(1);
      const outbox = await owner.query('SELECT 1 FROM notification_outbox WHERE user_id = $1', [
        'u-race',
      ]);
      expect(outbox.rowCount).toBe(1);
    });

    it('keeps only the newest notifications of a user when an alert fires', async () => {
      await seedUser('u-trim');
      await seedAlert('u-trim', 'al-trim', 1_000_00);
      await owner.query(
        `INSERT INTO notifications (user_id, kind, ref_id, title, body, created_at)
         SELECT 'u-trim', 'PRICE_ALERT', 'old-' || n, 'old ' || n, 'body', $1
           FROM generate_series(1, $2::int) AS n`,
        [AT, NOTIFICATIONS_KEPT],
      );
      const fired = await createPgAlertStore(app).fire(
        'al-trim',
        1_001_00,
        new Date('2026-09-28T05:30:00.000Z'),
      );
      const rows = await owner.query<{ id: string; ref_id: string }>(
        'SELECT id::text, ref_id FROM notifications WHERE user_id = $1 ORDER BY notifications.id',
        ['u-trim'],
      );
      expect(rows.rows).toHaveLength(NOTIFICATIONS_KEPT);
      // The oldest is gone, the new one is the newest and still present.
      expect(rows.rows[0]?.ref_id).toBe('old-2');
      expect(rows.rows.at(-1)?.ref_id).toBe('al-trim');
      expect(rows.rows.at(-1)?.id).toBe(fired?.notification.id);
    });
  });
});
