import type { MatcherFill } from '@nthstock/contracts';
import { MockMarketDataAdapter, generateSymbolMaster } from '@nthstock/marketData';
import { afterEach, describe, expect, it } from 'vitest';
import { manualClock } from '../../test/manualClock.js';
import { createMemoryAuditRepo } from '../audit/repo.js';
import { AccountConflict, type AccountStore } from './accountStore.js';
import { MATCHER_FILL_RETRIES, createOrderService, type OrderService } from './service.js';
import { createMemoryAccountStore } from './repo.js';

// The matcher's fill request on the account store (ADR 0013, NSTOCK-0367): the paths the reader
// tests stub out and the integration tests do not reach.

const USER = 'usr_fill';
const master = generateSymbolMaster({ equityCount: 20 });
const TOKEN = master.equities[0]?.instrument.token ?? 0;
const noTimers = { setInterval: () => 0, clearInterval: () => undefined };

let market: MockMarketDataAdapter | undefined;
let orders: OrderService | undefined;

afterEach(() => {
  orders?.dispose();
  market?.dispose();
  orders = undefined;
  market = undefined;
});

/** A resting BUY LIMIT order on a store whose commits `onCommit` can make lose or fail. */
async function setup(onCommit: (call: number) => Error | null) {
  const clock = manualClock('2026-09-28T04:30:00.000Z'); // Monday 10:00 IST, market open
  market = new MockMarketDataAdapter({ master, clock, scheduler: noTimers });
  const audit = createMemoryAuditRepo({ clock });
  const inner = createMemoryAccountStore({ audit });
  let armed = false;
  let calls = 0;
  const accounts: AccountStore = {
    ...inner,
    commit: async (userId, change, expectedVersion, entries) => {
      if (armed) {
        const failure = onCommit((calls += 1));
        if (failure) throw failure;
      }
      return inner.commit(userId, change, expectedVersion, entries);
    },
  };
  const service = createOrderService({
    clock,
    market,
    audit,
    accounts,
    onAuditError: () => undefined, // the failed commit is the point of the test
  });
  orders = service;
  // A limit 3% under the quote rests, inside the day's circuit band, on the 5-paise tick.
  const symbol = master.equities[0]?.instrument.symbol ?? '';
  const quote = await market.getQuote(symbol);
  const limit = Math.floor(((quote?.ltp ?? 0) * 0.97) / 5) * 5;
  const placed = await service.place(USER, {
    token: TOKEN,
    side: 'BUY',
    type: 'LIMIT',
    product: 'DELIVERY',
    qty: 1,
    price: limit,
  });
  armed = true;
  const fill: MatcherFill = {
    v: 1,
    userId: USER,
    token: TOKEN,
    ltp: limit,
    ts: clock.now().toISOString(),
    orderIds: [placed.id],
    stopIds: [],
  };
  const executed = async () =>
    (await audit.list(USER)).filter(
      (entry) => entry.action === 'ORDER_UPDATE' && entry.detail['status'] === 'EXECUTED',
    );
  const events: string[] = [];
  service.onOrderUpdate((_userId, order) => events.push(`order:${order.status}`));
  service.onAccountDelta(() => events.push('delta'));
  return { events, service, fill, executed, calls: () => calls, orderId: placed.id, accounts };
}

describe('applyMatcherFill', () => {
  it('runs once more after losing a commit on version, and fills the order once', async () => {
    const { service, fill, executed, calls, orderId, accounts, events } = await setup((call) =>
      call === 1 ? new AccountConflict(USER, 1, 2) : null,
    );

    await service.applyMatcherFill(fill);

    expect(calls()).toBe(2);
    // The lost commit published nothing; the retry published the fill once.
    expect(events.filter((event) => event === 'order:EXECUTED')).toHaveLength(1);
    expect(await executed()).toHaveLength(1);
    const page = await accounts.ordersPage(USER);
    expect(page?.items.find((order) => order.id === orderId)).toMatchObject({
      status: 'EXECUTED',
      filledQty: 1,
    });
    // Redelivered: the engine fills nothing twice.
    await service.applyMatcherFill(fill);
    expect(await executed()).toHaveLength(1);
  });

  it('rejects when the commit fails, so the reader leaves the request pending', async () => {
    const { service, fill, executed, events } = await setup(() => new Error('postgres is down'));

    await expect(service.applyMatcherFill(fill)).rejects.toMatchObject({ status: 500 });
    expect(await executed()).toHaveLength(0);
    // A socket never sees a fill the database does not have.
    expect(events).toEqual([]);
  });

  it('runs again up to MATCHER_FILL_RETRIES times, and fills once on the last (NSTOCK-0388)', async () => {
    const { service, fill, executed, calls, events } = await setup((call) =>
      call <= MATCHER_FILL_RETRIES ? new AccountConflict(USER, call, call + 1) : null,
    );

    await service.applyMatcherFill(fill);

    expect(calls()).toBe(MATCHER_FILL_RETRIES + 1);
    expect(events.filter((event) => event === 'order:EXECUTED')).toHaveLength(1);
    expect(await executed()).toHaveLength(1);
  });

  it('rejects with the real versions when every commit loses, and publishes nothing', async () => {
    const { service, fill, executed, calls, events } = await setup(
      (call) => new AccountConflict(USER, call, call + 1),
    );

    const rejected = service.applyMatcherFill(fill);
    await expect(rejected).rejects.toBeInstanceOf(AccountConflict);
    // The last attempt's versions, not placeholders.
    await expect(rejected).rejects.toMatchObject({
      userId: USER,
      expectedVersion: MATCHER_FILL_RETRIES + 1,
      actualVersion: MATCHER_FILL_RETRIES + 2,
    });
    expect(calls()).toBe(MATCHER_FILL_RETRIES + 1);
    expect(await executed()).toHaveLength(0);
    expect(events).toEqual([]);
  });
});
