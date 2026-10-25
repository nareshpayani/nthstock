import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../db/client.js';
import {
  describeWithPostgres,
  useTestPostgres,
  type TestPostgres,
} from '../../test/testPostgres.js';
import { createPgCandleStore, type CandleStore, type StoredBar } from './store.js';

// The candle store's two writes (NSTOCK-0373, NSTOCK-0374) on TimescaleDB.

const SESSION = '2026-10-23T03:45:00.000Z';
const at = (iso: string, price: number, volume = 10): StoredBar => ({
  token: 1,
  bucket: new Date(iso),
  open: price,
  high: price + 10,
  low: price - 10,
  close: price,
  volume,
});

describeWithPostgres('candle store (integration)', () => {
  let pg: TestPostgres;
  let database: Database;
  let store: CandleStore;
  let owner: Client;

  beforeAll(async () => {
    pg = await useTestPostgres();
    database = createDatabase({ url: pg.appUrl, poolMax: 2 });
    store = createPgCandleStore({ database });
    owner = new Client({ connectionString: pg.ownerUrl });
    await owner.connect();
  }, 180_000);

  afterAll(async () => {
    await owner.query('TRUNCATE candles_1m');
    await owner.end();
    await database.close();
  });

  beforeEach(async () => {
    await owner.query('TRUNCATE candles_1m');
  });

  const stored = async () =>
    (
      await store.readBars(
        1,
        '1m',
        new Date('2026-10-22T00:00:00Z'),
        new Date('2026-10-25T00:00:00Z'),
      )
    ).map((bar) => [bar.bucket.toISOString(), bar.open, bar.volume]);

  it('replaces a stored minute on upsert', async () => {
    await store.upsertMinuteBars([at(SESSION, 100)]);
    await store.upsertMinuteBars([at(SESSION, 200, 5)]);
    expect(await stored()).toEqual([[SESSION, 200, 5]]);
  });

  it('keeps a stored minute when inserting if absent, and does nothing for no bars', async () => {
    await store.upsertMinuteBars([at(SESSION, 100)]);
    await store.insertMinuteBarsIfAbsent([at(SESSION, 200, 5)]);
    await store.insertMinuteBarsIfAbsent([]);
    expect(await stored()).toEqual([[SESSION, 100, 10]]);
  });

  it('skips a whole-day row when the session already holds any minute, even without 09:15', async () => {
    await store.upsertMinuteBars([at('2026-10-23T04:00:00.000Z', 100)]);
    await store.insertMinuteBarsIfAbsent([
      at(SESSION, 300, 9_999),
      // The next session has nothing stored, so its row goes in.
      at('2026-10-22T03:45:00.000Z', 400, 7),
    ]);
    expect(await stored()).toEqual([
      ['2026-10-22T03:45:00.000Z', 400, 7],
      ['2026-10-23T04:00:00.000Z', 100, 10],
    ]);
  });

  it('upserts into a compressed chunk', async () => {
    await store.upsertMinuteBars([at(SESSION, 100)]);
    await owner.query(
      `SELECT compress_chunk(c, if_not_compressed => true) FROM show_chunks('candles_1m') c`,
    );
    await store.upsertMinuteBars([at(SESSION, 150, 3), at('2026-10-23T03:46:00.000Z', 160)]);
    expect(await stored()).toEqual([
      [SESSION, 150, 3],
      ['2026-10-23T03:46:00.000Z', 160, 10],
    ]);
  });
});
