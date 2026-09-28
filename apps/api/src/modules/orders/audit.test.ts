import { routes, type PlaceOrderRequest } from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { Client } from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../app.js';
import type { DepsOverrides } from '../../deps.js';
import { loginWithOtp } from '../../test/authFlow.js';
import { manualClock } from '../../test/manualClock.js';
import {
  describeWithPostgres,
  useTestPostgres,
  type TestPostgres,
} from '../../test/testPostgres.js';
import { createMemoryAuditRepo, type AuditRepo } from '../audit/repo.js';

// How the orders module writes the audit log now that appends are async (T-187).

const master = generateSymbolMaster({ equityCount: 20 });
const TOKEN = master.equities[0]?.instrument.token ?? 0;
const noTimers = { setInterval: () => 0, clearInterval: () => undefined };

let app: App | undefined;
let market: MockMarketDataAdapter | undefined;

async function start(deps: DepsOverrides) {
  const clock = manualClock('2026-09-28T04:30:00.000Z'); // Monday 10:00 IST, market open
  market = new MockMarketDataAdapter({ master, clock, scheduler: noTimers });
  app = buildApp({ deps: { clock, market, ...deps }, orderSweepMs: null });
  const user = await loginWithOtp(app, '9876543210');
  const place = (body: Partial<PlaceOrderRequest> = {}) =>
    (app as App).inject({
      method: 'POST',
      url: routes.orderPlace.path,
      headers: { authorization: `Bearer ${user.access}`, 'x-csrf-token': 'bearer' },
      payload: { token: TOKEN, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty: 1, ...body },
    });
  return { app, user, place };
}

afterEach(async () => {
  await app?.close();
  market?.dispose();
  app = undefined;
});

describe('orders audit writes', () => {
  it('keeps the instrument token out of the detail as "instrument"', async () => {
    const { app, user, place } = await start({});

    expect((await place({ qty: 2 })).statusCode).toBe(200);

    const entries = await app.deps.repos.audit.list(user.session.user.id);
    const placed = entries.find((entry) => entry.action === 'ORDER_PLACE');
    expect(placed?.detail['request']).toEqual({
      side: 'BUY',
      type: 'MARKET',
      product: 'DELIVERY',
      qty: 2,
      instrument: TOKEN,
    });
  });

  it("fails the request when its own entry cannot be written, and reports the fill's", async () => {
    const memory = createMemoryAuditRepo({ clock: manualClock() });
    const broken: AuditRepo = {
      ...memory,
      appendMany: () => Promise.reject(new Error('audit_log is down')),
    };
    const reported: string[] = [];
    const { place } = await start({
      repos: { audit: broken },
      onAuditError: (error) => reported.push(error.message),
    });

    const response = await place();

    expect(response.statusCode).toBe(500);
    // The order's own updates and fund movements went to onAuditError; so did the request's.
    expect(reported.length).toBeGreaterThan(1);
    expect(new Set(reported)).toEqual(new Set(['audit_log is down']));
  });
});

describeWithPostgres('orders audit on DB_DRIVER=postgres (integration)', () => {
  let pg: TestPostgres;

  beforeAll(async () => {
    pg = await useTestPostgres();
  }, 180_000);

  it('writes the order and its fund movements to audit_log, in the order the desk reported them', async () => {
    await pg.truncate();
    const { app, user, place } = await start({ dbDriver: 'postgres', databaseUrl: pg.appUrl });

    const response = await place();
    expect(response.statusCode).toBe(200);
    const orderId = response.json<{ id: string }>().id;

    const client = new Client({ connectionString: pg.appUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ action: string; type: string | null }>(
        `select action, detail->>'type' as type from audit_log
          where user_id = $1 and (order_id = $2 or action = 'FUNDS_MOVEMENT') order by id`,
        [user.session.user.id, orderId],
      );
      expect(rows.map((row) => row.type ?? row.action)).toEqual([
        // The desk reports order updates as they happen and the ledger once the action is done.
        'ORDER_UPDATE', // stored OPEN
        'ORDER_UPDATE', // filled
        'OPENING_CREDIT',
        'ORDER_BLOCK',
        'ORDER_RELEASE',
        'TRADE_DEBIT',
        'ORDER_PLACE',
      ]);
    } finally {
      await client.end();
    }
    expect((await app.deps.repos.audit.list(user.session.user.id)).at(-1)).toMatchObject({
      action: 'ORDER_PLACE',
      orderId,
      outcome: 'OK',
    });
  });
});
