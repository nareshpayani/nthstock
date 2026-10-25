import { CandleSeries, type Candle } from '@nthstock/contracts';
import {
  MockMarketDataAdapter,
  generateSymbolMaster,
  historyCalendar,
  instrumentHistory,
} from '@nthstock/marketData';
import { fixedClock, fromIst, type Clock } from '@nthstock/utils';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { createDatabase, type Database } from '../../db/client.js';
import {
  describeWithPostgres,
  useTestPostgres,
  type TestPostgres,
} from '../../test/testPostgres.js';
import { CANDLE_AGGREGATES, refreshWithOwner, seedCandles, seedRows } from './seed.js';
import { createPgCandleStore, type CandleStore } from './store.js';

// The candle history seed (NSTOCK-0374) and the candles route on stored bars (NSTOCK-0375), on
// TimescaleDB as migration 0014 builds it.

// Several tests run the whole seed (two years for two symbols, then five aggregate refreshes),
// which takes a few seconds on a CI runner: well past Vitest's 5 s default.
vi.setConfig({ testTimeout: 60_000 });

const master = generateSymbolMaster({ equityCount: 200 });
const SEEDED = ['INFY', 'NIFTY50'];
/** Daily history only: its intraday charts fall back to the generator. */
const DAILY_ONLY = 'TCS';
/** Not seeded at all. */
const UNSEEDED = 'HDFCBANK';
// Friday 23 Oct 2026, 16:00 IST: the history ends with Friday's session.
const seedClock = fixedClock(fromIst(2026, 10, 23, 16 * 60));
const calendar = historyCalendar(seedClock.now());
const noTimers = { setInterval: () => 0, clearInterval: () => undefined };
const FRIDAY_OPEN = '2026-10-23T03:45:00.000Z';

const token = (symbol: string) =>
  (master.equityBySymbol.get(symbol) ?? master.indexBySymbol.get(symbol))?.instrument.token ?? 0;

describeWithPostgres('candle history seed and stored candles (integration)', () => {
  let pg: TestPostgres;
  let database: Database;
  let store: CandleStore;
  let owner: Client;
  const apps: { app: App; market: MockMarketDataAdapter }[] = [];

  /** Empties candles_1m and drops what the aggregates materialised, so other suites see none. */
  const clearCandles = async () => {
    await owner.query('TRUNCATE candles_1m');
    for (const aggregate of CANDLE_AGGREGATES) {
      await owner.query(`CALL refresh_continuous_aggregate($1::regclass, NULL, NULL)`, [aggregate]);
    }
  };

  const seed = () =>
    seedCandles({
      store,
      master,
      clock: seedClock,
      symbols: SEEDED,
      refresh: refreshWithOwner(pg.ownerUrl),
    });

  beforeAll(async () => {
    pg = await useTestPostgres();
    owner = new Client({ connectionString: pg.ownerUrl });
    await owner.connect();
    await clearCandles();
    database = createDatabase({ url: pg.appUrl, poolMax: 4, statementTimeoutMs: 30_000 });
    store = createPgCandleStore({ database });
    await seed();
    await store.upsertMinuteBars(seedRows(master, DAILY_ONLY, calendar, false));
    await refreshWithOwner(pg.ownerUrl)(calendar.daily[0] as Date, new Date('2026-10-24'));
  }, 180_000);

  afterEach(async () => {
    for (const { app, market } of apps.splice(0)) {
      await app.close();
      market.dispose();
    }
  });

  afterAll(async () => {
    await clearCandles();
    await owner.end();
    await database.close();
  });

  const boot = (clock: Clock) => {
    const market = new MockMarketDataAdapter({ master, clock, scheduler: noTimers });
    const app = buildApp({ deps: { clock, market, database }, orderSweepMs: null });
    apps.push({ app, market });
    return { app, market };
  };

  const candles = async (app: App, symbol: string, range: string, interval?: string) => {
    const query = new URLSearchParams({ range, ...(interval ? { interval } : {}) });
    const response = await app.inject({
      method: 'GET',
      url: `/v1/market/instruments/${symbol}/candles?${query.toString()}`,
    });
    expect(response.statusCode, response.body).toBe(200);
    return CandleSeries.parse(response.json());
  };

  const asCandle = (row: {
    bucket: Date;
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
  }): Candle => ({
    t: row.bucket.toISOString(),
    o: Number(row.open),
    h: Number(row.high),
    l: Number(row.low),
    c: Number(row.close),
    v: Number(row.volume),
  });

  describe('the seed', () => {
    it('writes 375 minutes a session in the minute window and one 09:15 row a day before it', async () => {
      const { rows } = await owner.query<{ token: number; n: string }>(
        `select token, count(*) as n from candles_1m group by token order by token`,
      );
      const perSymbol =
        calendar.daily.length - calendar.minute.length + calendar.minute.length * 375;
      expect(rows).toEqual(
        [
          { token: token('INFY'), n: String(perSymbol) },
          { token: token('NIFTY50'), n: String(perSymbol) },
          { token: token(DAILY_ONLY), n: String(calendar.daily.length) },
        ].sort((a, b) => a.token - b.token),
      );
    });

    it('gives the same rows when run again', async () => {
      const digest = async () =>
        (
          await owner.query<{ digest: string }>(
            `select md5(string_agg(concat_ws(',', token, bucket, open, high, low, close, volume), ';'
                    order by token, bucket)) as digest from candles_1m`,
          )
        ).rows[0]?.digest;
      const before = await digest();
      const summary = await seed();
      expect(summary).toMatchObject({ symbols: 2, minuteSymbols: 2 });
      expect(summary.asOf.toISOString()).toBe(FRIDAY_OPEN);
      expect(await digest()).toBe(before);
    });

    it('refreshes the aggregates once over the whole seeded range', async () => {
      const calls: [Date, Date][] = [];
      await seedCandles({
        store,
        master,
        clock: seedClock,
        symbols: ['INFY'],
        refresh: (from, to) => {
          calls.push([from, to]);
          return Promise.resolve();
        },
      });
      expect(calls).toEqual([[calendar.daily[0], new Date(Date.parse(FRIDAY_OPEN) + 86_400_000)]]);
    });

    it('makes candles_1d the generated daily bars for all two years', async () => {
      const history = instrumentHistory(master, 'INFY', calendar, { minutes: false });
      const { rows } = await owner.query(
        `select bucket, open, high, low, close, volume from candles_1d where token = $1 order by bucket`,
        [token('INFY')],
      );
      const stored = rows.map(asCandle);
      const daily = history?.daily ?? [];
      expect(stored.map((bar) => bar.t)).toEqual(daily.map((bar) => bar.t));
      // Every day opens and closes as generated; before the minute window it is the bar itself.
      expect(stored.map((bar) => [bar.o, bar.c])).toEqual(daily.map((bar) => [bar.o, bar.c]));
      const older = daily.length - calendar.minute.length;
      expect(stored.slice(0, older)).toEqual(daily.slice(0, older));
    });

    it('needs the owner to refresh the aggregates: the app role may not', async () => {
      const app = new Client({ connectionString: pg.appUrl });
      await app.connect();
      try {
        await expect(
          app.query(`CALL refresh_continuous_aggregate('candles_1d', NULL, NULL)`),
        ).rejects.toThrow(/must be owner/);
      } finally {
        await app.end();
      }
    });
  });

  describe('GET /v1/market/instruments/:symbol/candles on stored bars', () => {
    // Monday 26 Oct 2026, 08:00 IST: before the open, so the charts end with Friday's session.
    const monday = fixedClock(fromIst(2026, 10, 26, 8 * 60));

    it('serves 1D from the stored minutes, and the same bars again on a reload', async () => {
      const { app, market } = boot(monday);
      const series = await candles(app, 'INFY', '1D');
      expect(series).toMatchObject({ symbol: 'INFY', range: '1D', interval: '1m' });
      const minutes = (
        instrumentHistory(master, 'INFY', calendar, { minutes: true })?.minutes ?? []
      ).slice(-375);
      expect(series.candles).toHaveLength(375);
      expect(series.candles[0]?.t).toBe(FRIDAY_OPEN);
      // Every bar as stored, but the last, which closes at the live LTP.
      expect(series.candles.slice(0, -1)).toEqual(minutes.slice(0, -1));
      const quote = await market.getQuote('INFY');
      expect(series.candles.at(-1)?.c).toBe(quote?.ltp);
      expect(series.candles.at(-1)?.o).toBe(minutes.at(-1)?.o);

      expect(await candles(app, 'INFY', '1D')).toEqual(series);
      // A restarted apps/api (a new process, a new adapter) reads the same rows.
      const again = boot(monday);
      const reloaded = await candles(again.app, 'INFY', '1D');
      expect(reloaded.candles.slice(0, -1)).toEqual(series.candles.slice(0, -1));
    });

    it('starts 15-minute bars at 09:15 IST from candles_15m', async () => {
      const { app } = boot(monday);
      const series = await candles(app, 'INFY', '1D', '15m');
      expect(series.interval).toBe('15m');
      expect(series.candles).toHaveLength(25);
      expect(series.candles.slice(0, 3).map((bar) => bar.t)).toEqual([
        FRIDAY_OPEN,
        '2026-10-23T04:00:00.000Z',
        '2026-10-23T04:15:00.000Z',
      ]);
      // The 15:15 bar is the session's last 15 minutes.
      expect(series.candles.at(-1)?.t).toBe('2026-10-23T09:45:00.000Z');
    });

    it('serves 1W, 1M, 1Y and 5Y over the generator windows from the aggregates', async () => {
      const { app, market } = boot(monday);
      const ltp = (await market.getQuote('NIFTY50'))?.ltp;
      const week = await candles(app, 'NIFTY50', '1W');
      // Mon 19, Wed 21, Thu 22, Fri 23 Oct (Tue 20 is Dussehra) and Fri 16: five sessions of 75.
      expect(week.candles).toHaveLength(5 * 75);
      expect(week.candles[0]?.t).toBe('2026-10-16T03:45:00.000Z');
      const month = await candles(app, 'NIFTY50', '1M');
      expect(month.interval).toBe('1h');
      expect(month.candles).toHaveLength(22 * 7);
      expect(month.candles.slice(0, 2).map((bar) => bar.t.slice(11, 16))).toEqual([
        '03:45',
        '04:45',
      ]);
      const days = await candles(app, 'NIFTY50', '1M', '1d');
      expect(days.candles).toHaveLength(22);
      const year = await candles(app, 'NIFTY50', '1Y');
      const history = instrumentHistory(master, 'NIFTY50', calendar, { minutes: false });
      const yearAgo = fromIst(2025, 10, 23, 555).getTime();
      const inYear = (history?.daily ?? []).filter((bar) => Date.parse(bar.t) > yearAgo);
      expect(year.candles.map((bar) => bar.t)).toEqual(inYear.map((bar) => bar.t));
      const weeks = await candles(app, 'NIFTY50', '5Y');
      expect(weeks.interval).toBe('1w');
      expect(weeks.candles.length).toBeGreaterThan(100);
      expect(weeks.candles.length).toBeLessThan(110);
      for (const series of [week, month, days, year, weeks]) {
        expect(series.candles.at(-1)?.c).toBe(ltp);
      }
    });

    it('moves the forming bar with the live quote during a session', async () => {
      // Monday 26 Oct 2026, 11:02 IST: today has no stored bars yet; the last bar is the quote's.
      const clock = fixedClock(fromIst(2026, 10, 26, 11 * 60 + 2));
      const { app, market } = boot(clock);
      const week = await candles(app, 'INFY', '1W');
      const quote = await market.getQuote('INFY');
      const last = week.candles.at(-1);
      const previous = week.candles.at(-2);
      expect(last?.t).toBe('2026-10-26T05:30:00.000Z');
      expect(last?.c).toBe(quote?.ltp);
      expect(last?.o).toBe(previous?.c);
      expect(previous?.t).toBe('2026-10-23T09:55:00.000Z');
      expect(week.candles).toHaveLength(4 * 75 + 1);

      const year = await candles(app, 'INFY', '1Y');
      expect(year.candles.at(-1)).toMatchObject({
        t: '2026-10-26T03:45:00.000Z',
        o: quote?.open,
        c: quote?.ltp,
      });
      // Today's session itself has no stored minutes: the generator's 1D, as before.
      expect(await candles(app, 'INFY', '1D')).toEqual(await market.getCandles('INFY', '1D'));
    });

    it('falls back to the generator for an unseeded symbol and for intraday daily-only history', async () => {
      const { app, market } = boot(monday);
      for (const range of ['1D', '1W', '1M', '1Y'] as const) {
        expect(await candles(app, UNSEEDED, range)).toEqual(
          await market.getCandles(UNSEEDED, range),
        );
      }
      for (const range of ['1D', '1W', '1M'] as const) {
        expect(await candles(app, DAILY_ONLY, range)).toEqual(
          await market.getCandles(DAILY_ONLY, range),
        );
      }
      const year = await candles(app, DAILY_ONLY, '1Y');
      expect(year).not.toEqual(await market.getCandles(DAILY_ONLY, '1Y'));
      expect(year.candles.at(-2)?.c).toBe(
        instrumentHistory(master, DAILY_ONLY, calendar, { minutes: false })?.daily.at(-2)?.c,
      );
    });
  });
  // Last: these change the stored rows the route tests above read.
  describe('after the seed', () => {
    const dailyBars = async (symbol: string) =>
      (
        await owner.query(
          `select bucket, open, high, low, close, volume from candles_1d where token = $1
            order by bucket`,
          [token(symbol)],
        )
      ).rows.map(asCandle);

    it('keeps every seeded day readable once the refresh policies have run', async () => {
      const before = await dailyBars('INFY');
      const { rows: jobs } = await owner.query<{ id: number }>(
        `select job_id as id from timescaledb_information.jobs
          where proc_name = 'policy_refresh_continuous_aggregate'`,
      );
      expect(jobs).toHaveLength(CANDLE_AGGREGATES.length);
      // Each run moves its aggregate's watermark to the present; history it never materialised
      // would drop out of real-time reads here.
      for (const job of jobs) await owner.query('CALL run_job($1)', [job.id]);
      expect(await dailyBars('INFY')).toEqual(before);
      expect(before).toHaveLength(calendar.daily.length);
    });

    it('keeps the minute bars of a session that slid out of the minute window on a later seed', async () => {
      const oldest = calendar.minute[0] as Date;
      const minutesOf = async () =>
        (
          await owner.query<{ n: string; volume: string }>(
            `select count(*) as n, sum(volume)::bigint as volume from candles_1m
              where token = $1 and bucket >= $2 and bucket < $2::timestamptz + interval '1 day'`,
            [token('INFY'), oldest.toISOString()],
          )
        ).rows[0];
      const before = await minutesOf();
      expect(before?.n).toBe('375');

      // A week later the oldest minute session is outside the window.
      const laterClock = fixedClock(fromIst(2026, 10, 30, 16 * 60));
      expect(historyCalendar(laterClock.now()).minute[0]?.getTime()).toBeGreaterThan(
        oldest.getTime(),
      );
      await seedCandles({
        store,
        master,
        clock: laterClock,
        symbols: ['INFY'],
        refresh: refreshWithOwner(pg.ownerUrl),
      });

      expect(await minutesOf()).toEqual(before);
      const day = (await dailyBars('INFY')).find((bar) => bar.t === oldest.toISOString());
      expect(day?.v).toBe(Number(before?.volume));
    });
  });
});
