import { MATCHER_COMMAND_VERSION } from '@nthstock/contracts';
import { shardOf } from '@nthstock/utils';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { startMatcher, type Matcher } from './matcher.js';
import { createPgLiveOrderSource } from './pgLiveOrders.js';
import { describeWithPostgres, startTestPostgres } from './test/testPostgres.js';
import {
  describeWithRedis,
  startTestRedis,
  uniqueChannel,
  type TestRedis,
} from './test/testRedis.js';

// NSTOCK-0366 acceptance: the matcher loads its shard's live orders from Postgres on start, and
// the next reconcile repairs a command that never reached it.

const SHARDS = 2;
const SHARD = 0;
const tokens = Array.from({ length: 20 }, (_, i) => i + 1);
const [T1 = 0, T2 = 0] = tokens.filter((t) => shardOf(t, SHARDS) === SHARD);
const OTHER = tokens.find((t) => shardOf(t, SHARDS) !== SHARD) ?? 0;
const silent = { info: () => undefined, warn: () => undefined };
const AT = '2026-09-28T04:30:00.000Z';

describeWithPostgres('matcher reconcile (integration, NSTOCK-0366)', () => {
  describeWithRedis('with Redis', () => {
    let redisServer: TestRedis | undefined;
    let redis: Redis;
    let owner: Pool;
    let app: Pool;

    beforeAll(async () => {
      const pg = await startTestPostgres();
      owner = new Pool({ connectionString: pg.ownerUrl, max: 2 });
      app = new Pool({ connectionString: pg.appUrl, max: 1 });
      redisServer = await startTestRedis();
      redis = new Redis(redisServer.url);
    }, 180_000);

    afterAll(async () => {
      await app.end();
      await owner.end();
      redis.disconnect();
      await redisServer?.stop();
    });

    /** The rows apps/api writes for a user and their orders. */
    async function seedUser(userId: string, version: number) {
      // Placeholder bytes stand in for the encrypted mobile: the matcher never reads them.
      await owner.query(
        `INSERT INTO users (id, mobile_enc, mobile_hash, mobile_last4, created_at, updated_at)
         VALUES ($1, '\\x00', sha256(convert_to($1, 'UTF8')), '0001', $2, $2)`,
        [userId, AT],
      );
      await owner.query(
        `INSERT INTO paper_accounts (user_id, opening_balance, version, synced_to, created_at, updated_at)
         VALUES ($1, 100000000, $2, $3, $3, $3)`,
        [userId, version, AT],
      );
    }
    async function seedOrder(
      userId: string,
      id: string,
      token: number,
      price: number,
      shard: number | null,
    ) {
      await owner.query(
        `INSERT INTO orders (id, trade_date, user_id, token, symbol, exchange, side, type, product,
           qty, price, filled_qty, status, shard, placed_at, updated_at)
         VALUES ($1, '2026-09-28', $2, $3, 'TEST', 'NSE', 'BUY', 'LIMIT', 'DELIVERY', 1, $4, 0,
           'OPEN', $5, $6, $6)`,
        [id, userId, token, price, shard, AT],
      );
    }
    /** An active trailing stop as apps/api stores it: a long TRAILING stop with a ₹10 trail. */
    async function seedStop(userId: string, id: string, token: number, stopPrice: number) {
      await owner.query(
        `INSERT INTO trailing_stops (id, user_id, token, symbol, exchange, product, direction,
           trail_unit, trail_amount, exit_order_type, status, watermark_price, stop_price,
           protected_qty, seq, created_at, updated_at)
         VALUES ($1, $2, $3, 'TEST', 'NSE', 'DELIVERY', 'LONG', 'AMOUNT', 1000, 'MARKET',
           'TRAILING', $4, $5, 1, 1, $6, $6)`,
        [id, userId, token, stopPrice + 10_00, stopPrice, AT],
      );
    }
    const setStopStatus = (id: string, status: string) =>
      owner.query('UPDATE trailing_stops SET status = $2 WHERE id = $1', [id, status]);
    const setAccountVersion = (userId: string, version: number) =>
      owner.query('UPDATE paper_accounts SET version = $2 WHERE user_id = $1', [userId, version]);
    const setStatus = (id: string, status: string) =>
      owner.query('UPDATE orders SET status = $2 WHERE id = $1', [id, status]);

    it('loads on start, and the next round repairs a lost ADD and a lost CANCEL', async () => {
      const prefix = uniqueChannel('reconcile');
      await seedUser('u1', 3);
      await seedOrder('u1', 'o1', T1, 100_00, SHARD);
      // A row from before the shard column, on this shard by its token, and one on another shard.
      await seedOrder('u1', 'o-old', T2, 99_00, null);
      await seedOrder('u1', 'o-other', OTHER, 98_00, 1 - SHARD);

      const matcher: Matcher = startMatcher({
        client: new Redis(redisServer?.url ?? '', { maxRetriesPerRequest: null }),
        shard: SHARD,
        holdsLease: () => true,
        alwaysOpen: true,
        onTick: () => undefined,
        log: silent,
        blockMs: 100,
        streamKey: () => `${prefix}:ticks`,
        snapshotKey: () => `${prefix}:last`,
        commands: {
          client: new Redis(redisServer?.url ?? '', { maxRetriesPerRequest: null }),
          commandsKey: () => `${prefix}:commands`,
        },
        reconcile: { source: createPgLiveOrderSource(app), shards: SHARDS, timer: null },
      });
      try {
        await matcher.ready();
        expect(matcher.book(T1).hasOrder('o1')).toBe(true);
        expect(matcher.book(T2).hasOrder('o-old')).toBe(true);
        expect(matcher.books.has(OTHER)).toBe(false);

        // apps/api cancels o1 and places o2, but neither command reaches the matcher.
        await setStatus('o1', 'CANCELLED');
        await seedOrder('u1', 'o2', T1, 97_00, SHARD);
        await setAccountVersion('u1', 5);
        // A command that does arrive, newer than anything Postgres will show the next round.
        const modify = {
          v: MATCHER_COMMAND_VERSION,
          type: 'MODIFY',
          token: T2,
          version: 6,
          orderId: 'o-old',
          userId: 'u1',
          side: 'BUY',
          price: 96_00,
        };
        await redis.xadd(`${prefix}:commands`, '*', 'command', JSON.stringify(modify));
        await vi.waitFor(() => expect(matcher.stats().commands).toBe(1));

        expect(await matcher.reconcile?.run()).toEqual({
          added: 1,
          removed: 1,
          stopsAdded: 0,
          stopsRemoved: 0,
        });
        expect([...matcher.book(T1).orders()].map((o) => [o.orderId, o.version])).toEqual([
          ['o2', 5],
        ]);
        // The newer command stands: the round read o-old at version 5, at its old price.
        expect([...matcher.book(T2).orders()].map((o) => [o.price, o.version])).toEqual([
          [96_00, 6],
        ]);
      } finally {
        await matcher.close();
      }
    });

    it('loads active stops on start, and the next round repairs a lost STOP_ADD and STOP_CANCEL', async () => {
      const prefix = uniqueChannel('reconcile-stops');
      await seedUser('s1', 3);
      await seedStop('s1', 't1', T1, 90_00);
      await seedStop('s1', 't-other', OTHER, 90_00);
      // Not on a book: waiting for its entry, and already triggered.
      await seedStop('s1', 't-pending', T1, 90_00);
      await setStopStatus('t-pending', 'PENDING_ENTRY');
      await seedStop('s1', 't-done', T1, 90_00);
      await setStopStatus('t-done', 'TRIGGERED');

      const matcher: Matcher = startMatcher({
        client: new Redis(redisServer?.url ?? '', { maxRetriesPerRequest: null }),
        shard: SHARD,
        holdsLease: () => true,
        alwaysOpen: true,
        onTick: () => undefined,
        log: silent,
        blockMs: 100,
        streamKey: () => `${prefix}:ticks`,
        snapshotKey: () => `${prefix}:last`,
        commands: {
          client: new Redis(redisServer?.url ?? '', { maxRetriesPerRequest: null }),
          commandsKey: () => `${prefix}:commands`,
        },
        reconcile: { source: createPgLiveOrderSource(app), shards: SHARDS, timer: null },
      });
      try {
        await matcher.ready();
        expect([...matcher.book(T1).stops()].map((s) => [s.stopId, s.version])).toEqual([
          ['t1', 3],
        ]);
        expect(matcher.books.has(OTHER)).toBe(false);

        // apps/api cancels t1 and places t2, but neither command reaches the matcher.
        await setStopStatus('t1', 'CANCELLED');
        await seedStop('s1', 't2', T2, 95_00);
        await setAccountVersion('s1', 5);

        expect(await matcher.reconcile?.run()).toEqual({
          added: 0,
          removed: 0,
          stopsAdded: 1,
          stopsRemoved: 1,
        });
        expect(matcher.book(T1).hasStop('t1')).toBe(false);
        expect(
          [...matcher.book(T2).stops()].map((s) => [s.stopId, s.version, s.state.stopPrice]),
        ).toEqual([['t2', 5, 95_00]]);
      } finally {
        await matcher.close();
      }
    });
  });
});
