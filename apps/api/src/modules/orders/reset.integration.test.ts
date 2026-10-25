import {
  FundsSummary,
  LedgerPage,
  Order,
  OrdersPage,
  PAPER_OPENING_BALANCE_PAISE,
  routes,
} from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import { createDatabase, type Database } from '../../db/client.js';
import { loginWithOtp } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';
import {
  describeWithPostgres,
  useTestPostgres,
  type TestPostgres,
} from '../../test/testPostgres.js';
import { createPgAuditRepo, type AuditRepo } from '../audit/index.js';

// The paper account reset is one Postgres transaction (T-205): the cancellations, the cleared
// positions and holdings, the RESET ledger entry, the version bump and the audit entries commit
// together or not at all.

const master = generateSymbolMaster({ equityCount: 20 });
const EQUITY = master.equities[0]?.instrument;
const TOKEN = EQUITY?.token ?? 0;
const noTimers = { setInterval: () => 0, clearInterval: () => undefined };

let app: App | undefined;
let market: MockMarketDataAdapter | undefined;
let database: Database | undefined;

afterEach(async () => {
  await app?.close();
  market?.dispose();
  await database?.close();
  app = undefined;
  database = undefined;
});

describeWithPostgres('paper account reset on Postgres (integration, T-205)', () => {
  let pg: TestPostgres;

  beforeAll(async () => {
    pg = await useTestPostgres();
  }, 180_000);

  /** apps/api on the test database; `failReset` makes the audit log refuse the reset's entry. */
  async function start(failReset: boolean) {
    await pg.truncate();
    const clock = manualClock('2026-09-28T04:30:00.000Z'); // Monday 10:00 IST, market open
    market = new MockMarketDataAdapter({ master, clock, scheduler: noTimers });
    database = createDatabase({ url: pg.appUrl, poolMax: 4 });
    const pgAudit = createPgAuditRepo({ database, clock });
    const audit: AuditRepo = {
      ...pgAudit,
      appendMany: (entries, tx) =>
        failReset && entries.some((entry) => entry.action === 'FUNDS_RESET')
          ? Promise.reject(new Error('audit_log is down'))
          : pgAudit.appendMany(entries, tx),
    };
    app = buildApp({
      deps: { clock, market, database, repos: { audit }, onAuditError: () => undefined },
      orderSweepMs: null,
    });
    const user = await loginWithOtp(app, '9876543210');
    const headers = { authorization: `Bearer ${user.access}`, 'x-csrf-token': 'bearer' };
    const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
      (app as App).inject({ method, url, headers, ...(payload ? { payload } : {}) });
    const quote = await market.getQuote(EQUITY?.symbol ?? '');
    if (!quote) throw new Error('no quote');
    const order = { token: TOKEN, side: 'BUY', product: 'DELIVERY', qty: 2 };
    expect(
      (await call('POST', routes.orderPlace.path, { ...order, type: 'MARKET' })).statusCode,
    ).toBe(200);
    // Below the LTP, so it rests OPEN with its funds blocked.
    const resting = Order.parse(
      (
        await call('POST', routes.orderPlace.path, {
          ...order,
          type: 'LIMIT',
          price: quote.ltp - 1_000,
        })
      ).json(),
    );
    const ledger = async () =>
      LedgerPage.parse((await call('GET', `${routes.fundsLedger.path}?limit=100`)).json()).items;
    const orders = async () => OrdersPage.parse((await call('GET', routes.ordersList.path)).json());
    const funds = async () =>
      FundsSummary.parse((await call('GET', routes.fundsSummary.path)).json());
    const reset = () => call('POST', routes.fundsReset.path, { confirm: 'RESET' });
    return { user, resting, ledger, orders, funds, reset };
  }

  it('restores ₹10,00,000.00 and keeps the earlier ledger rows', async () => {
    const { ledger, orders, funds, reset } = await start(false);
    const before = await ledger();

    const response = await reset();

    expect(response.statusCode).toBe(200);
    expect(FundsSummary.parse(response.json())).toMatchObject({
      balance: PAPER_OPENING_BALANCE_PAISE,
      available: PAPER_OPENING_BALANCE_PAISE,
      blocked: 0,
    });
    const after = await ledger();
    expect(after[0]?.type).toBe('RESET');
    // The resting order's block is released, then the RESET entry; every earlier row stays.
    expect(after.slice(-before.length)).toEqual(before);
    expect((await orders()).items).toEqual([]);
    expect(await funds()).toMatchObject({ available: PAPER_OPENING_BALANCE_PAISE });
  });

  it('leaves the stored account unchanged when the reset cannot be committed', async () => {
    const { resting, ledger, orders, funds, reset } = await start(true);
    const [ledgerBefore, ordersBefore, fundsBefore] = await Promise.all([
      ledger(),
      orders(),
      funds(),
    ]);

    expect((await reset()).statusCode).toBe(500);

    // The engine was reloaded from the store: the open order, its block and the ledger are back.
    expect(await ledger()).toEqual(ledgerBefore);
    // The store keeps no `seq` (ADR 0012), so a reloaded order has none.
    const withoutSeq = ({ items }: OrdersPage) =>
      items.map((order) => ({ ...order, seq: undefined }));
    expect(withoutSeq(await orders())).toEqual(withoutSeq(ordersBefore));
    expect((await orders()).items.find((order) => order.id === resting.id)?.status).toBe('OPEN');
    expect(await funds()).toEqual({ ...fundsBefore, asOf: expect.any(String) });
  });
});
