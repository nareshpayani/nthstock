import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { describeWithPostgres, useTestPostgres, type TestPostgres } from '../test/testPostgres.js';
import { orderTradeDate } from './orderTradeDate.js';

// orders and order_events, partitioned by IST trade_date (T-201, spec backend-core §4.3).

const insertOrder = (client: Client, id: string, tradeDate: string, status = 'OPEN') =>
  client.query<{ partition: string }>(
    `INSERT INTO orders (id, trade_date, user_id, token, symbol, exchange, side, type, product,
                         qty, price, status, placed_at, updated_at)
     VALUES ($1, $2, 'usr_a', 2885, 'RELIANCE', 'NSE', 'BUY', 'LIMIT', 'DELIVERY',
             10, 250000, $3, now(), now())
     RETURNING tableoid::regclass::text AS partition`,
    [id, tradeDate, status],
  );

describe('orderTradeDate', () => {
  // Friday 2026-10-09 is a trading day; Saturday and Sunday are not.
  it.each([
    ['2026-10-09T09:00:00+05:30', '2026-10-09'], // before the open
    ['2026-10-09T15:29:00+05:30', '2026-10-09'], // last minute of the session
    ['2026-10-09T15:30:00+05:30', '2026-10-12'], // at the close: next session (Monday)
    ['2026-10-09T20:00:00+05:30', '2026-10-12'], // 20:00 IST AMO
    ['2026-10-10T11:00:00+05:30', '2026-10-12'], // Saturday
    ['2026-10-19T20:00:00+05:30', '2026-10-21'], // Dussehra (10-20) is skipped
    ['2026-10-09T18:30:00Z', '2026-10-12'], // 00:00 IST Saturday, given in UTC
  ])('%s belongs to %s', (placedAt, expected) => {
    expect(orderTradeDate(new Date(placedAt))).toBe(expected);
  });
});

describeWithPostgres('order partitions (integration)', () => {
  let pg: TestPostgres;
  let owner: Client;
  let app: Client;

  beforeAll(async () => {
    pg = await useTestPostgres();
    owner = new Client({ connectionString: pg.ownerUrl });
    app = new Client({ connectionString: pg.appUrl });
    await Promise.all([owner.connect(), app.connect()]);
  }, 180_000);

  afterAll(async () => {
    await Promise.all([owner.end(), app.end()]);
  });

  beforeEach(async () => {
    await pg.truncate();
  });

  const partitionsOf = async (parent: string) =>
    (
      await owner.query<{ name: string }>(
        `select c.relname as name
           from pg_inherits i
           join pg_class c on c.oid = i.inhrelid
          where i.inhparent = $1::regclass
          order by c.relname`,
        [parent],
      )
    ).rows.map((row) => row.name);

  it('has a DEFAULT partition from the migration, and no daily partitions yet', async () => {
    expect(await partitionsOf('orders')).toEqual(['orders_default']);
    expect(await partitionsOf('order_events')).toEqual(['order_events_default']);
  });

  it('creates daily partitions for both tables, idempotently', async () => {
    const first = await app.query<{ n: number }>(
      `select ensure_order_partitions('2026-11-02', 3) as n`,
    );
    expect(first.rows[0]?.n).toBe(3);
    expect(await partitionsOf('orders')).toEqual([
      'orders_20261102',
      'orders_20261103',
      'orders_20261104',
      'orders_default',
    ]);
    expect(await partitionsOf('order_events')).toEqual([
      'order_events_20261102',
      'order_events_20261103',
      'order_events_20261104',
      'order_events_default',
    ]);

    const again = await app.query<{ n: number }>(
      `select ensure_order_partitions('2026-11-03', 3) as n`,
    );
    expect(again.rows[0]?.n).toBe(1); // only 2026-11-05 is new
  });

  it('rejects a day count outside 1 to 400', async () => {
    await expect(
      app.query(`select ensure_order_partitions('2026-11-02', 0)`),
    ).rejects.toMatchObject({ code: '22023' });
  });

  it('keeps DDL closed to the app role', async () => {
    await expect(app.query('CREATE TABLE orders_manual (id int)')).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('puts an order for a trade date in that date partition', async () => {
    await app.query(`select ensure_order_partitions('2026-12-01', 2)`);

    const { rows } = await insertOrder(app, 'ord_1', '2026-12-02');
    expect(rows[0]?.partition).toBe('orders_20261202');
  });

  it('puts an order for a date without a partition in DEFAULT', async () => {
    const { rows } = await insertOrder(app, 'ord_2', '2031-01-06');
    expect(rows[0]?.partition).toBe('orders_default');
  });

  it('puts an order placed at 20:00 IST in the next trading day partition', async () => {
    await app.query(`select ensure_order_partitions('2026-10-09', 5)`);
    const placedAt = new Date('2026-10-09T20:00:00+05:30');

    const tradeDate = orderTradeDate(placedAt);
    const { rows } = await insertOrder(app, 'ord_amo', tradeDate, 'AMO');

    expect(tradeDate).toBe('2026-10-12');
    expect(rows[0]?.partition).toBe('orders_20261012');
  });

  it('routes order_events the same way and keeps (trade_date, order_id, seq) unique', async () => {
    await app.query(`select ensure_order_partitions('2026-12-01', 1)`);
    const event = (date: string, seq: number) =>
      app.query<{ partition: string }>(
        `INSERT INTO order_events (trade_date, order_id, user_id, seq, event, status, at, qty, type)
         VALUES ($1, 'ord_1', 'usr_a', $2, 'PLACED', 'OPEN', now(), 10, 'MARKET')
         RETURNING tableoid::regclass::text AS partition`,
        [date, seq],
      );

    expect((await event('2026-12-01', 1)).rows[0]?.partition).toBe('order_events_20261201');
    expect((await event('2031-01-06', 1)).rows[0]?.partition).toBe('order_events_default');
    await expect(event('2026-12-01', 1)).rejects.toMatchObject({ code: '23505' });
  });

  it('enforces the order checks and the (trade_date, id) key', async () => {
    await insertOrder(app, 'ord_1', '2031-01-06');
    await expect(insertOrder(app, 'ord_1', '2031-01-06')).rejects.toMatchObject({ code: '23505' });
    await expect(
      app.query(
        `INSERT INTO orders (id, trade_date, user_id, token, symbol, exchange, side, type, product,
                             qty, price, status, placed_at, updated_at)
         VALUES ('ord_bad', '2031-01-06', 'usr_a', 1, 'X', 'NSE', 'BUY', 'LIMIT', 'DELIVERY',
                 1, 251, 'OPEN', now(), now())`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('indexes live orders with a partial index on every partition', async () => {
    await app.query(`select ensure_order_partitions('2026-12-01', 1)`);
    const { rows } = await owner.query<{ tablename: string; indexdef: string }>(
      `select tablename, indexdef from pg_indexes
        where tablename in ('orders_20261201', 'orders_default')
          and indexdef like '%status%'`,
    );
    expect(rows.map((row) => row.tablename).sort()).toEqual(['orders_20261201', 'orders_default']);
    for (const row of rows) expect(row.indexdef).toMatch(/AMO.*OPEN/);
  });

  it('gives new partitions the app role DML grants', async () => {
    await app.query(`select ensure_order_partitions('2026-12-01', 1)`);
    const { rows } = await app.query<{ ok: boolean }>(
      `select has_table_privilege('nthstock_app', 'orders_20261201', 'INSERT, UPDATE') as ok`,
    );
    expect(rows[0]?.ok).toBe(true);
  });
});
