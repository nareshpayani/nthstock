// @vitest-environment node
import {
  CONSENT_POLICY_VERSION,
  DEV_OTP,
  WsServerMessage,
  type Quote,
  type WsAccountDelta,
} from '@nthstock/contracts';
import {
  createScenarioClient,
  fetchBackend,
  type ScenarioClient,
} from '@nthstock/contracts/testing';
import { fixedClock, fromIst } from '@nthstock/utils';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_API_ORIGIN, TEST_WS_URL, createMockServer } from '../node';
import { ORDERS_MOCK_STORAGE_KEY, type TimeoutTimers } from './orders';

/**
 * The mock transport for Trade from Charts (T08, SPEC-TFC-1 §10): trailing-stop routes, the account
 * snapshot, throttled persistence and `accountDelta` frames, over the same MSW node server the
 * other handler tests use.
 */

/** Monday 28 Sep 2026, 10:00 IST: the market is open. */
const OPEN_MS = fromIst(2026, 9, 28, 10 * 60).getTime();

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    writes: 0,
    getItem: (key: string) => data.get(key) ?? null,
    setItem(key: string, value: string) {
      this.writes += 1;
      data.set(key, value);
    },
  };
}

type Storage = ReturnType<typeof memoryStorage>;

/** Timeouts the test fires by hand, so the save throttle runs only when the test says. */
function manualTimeouts() {
  const pending = new Map<number, () => void>();
  let next = 0;
  const timeouts: TimeoutTimers = {
    setTimeout: (callback) => {
      next += 1;
      pending.set(next, callback);
      return next;
    },
    clearTimeout: (handle) => {
      pending.delete(handle as number);
    },
  };
  const fire = () => {
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks) callback();
  };
  return { timeouts, pending, fire };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function pageLoad(
  storages: { auth?: Storage; orders?: Storage } = {},
  timeouts?: TimeoutTimers,
  at = OPEN_MS,
) {
  const mock = createMockServer({
    clock: fixedClock(at),
    tickIntervalMs: 1_000_000_000,
    flushMs: 20,
    auth: { now: () => at, ...(storages.auth ? { storage: storages.auth } : {}) },
    orders: {
      ...(storages.orders ? { storage: storages.orders } : {}),
      ...(timeouts ? { timeouts } : {}),
    },
  });
  mock.server.listen({ onUnhandledFrame: 'error' });
  cleanups.push(() => {
    mock.server.close();
    mock.orders.dispose();
    mock.adapter.dispose();
  });
  const client = createScenarioClient(fetchBackend(TEST_API_ORIGIN, fetch));
  return { ...mock, client };
}

/** Moves a page's sign-in cookies to the next page load. */
function carryCookies(from: ScenarioClient, to: ScenarioClient) {
  const cookies = from.cookies.header() ?? '';
  to.cookies.store(cookies.split('; ').map((pair) => `${pair}; Path=/`));
}

async function login(client: ScenarioClient, mobile: string) {
  const { requestId } = await client.call('otpRequest', { body: { mobile } });
  await client.call('otpVerify', {
    body: { requestId, mobile, otp: DEV_OTP, consentVersion: CONSENT_POLICY_VERSION },
  });
}

async function infy(client: ScenarioClient): Promise<Quote> {
  const { items } = await client.call('marketQuotes', { query: { symbols: 'INFY' } });
  const [quote] = items;
  if (!quote) throw new Error('INFY has no quote');
  return quote;
}

/** Signs in, pins INFY and buys 10 at market: a long Delivery position to protect. */
async function longPosition(page: ReturnType<typeof pageLoad>, mobile: string) {
  await login(page.client, mobile);
  const quote = await infy(page.client);
  const price = quote.ltp - (quote.ltp % 5);
  page.orders.pinPrice(quote.token, price);
  const entry = await page.client.call('orderPlace', {
    body: { token: quote.token, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty: 10 },
  });
  expect(entry.status).toBe('EXECUTED');
  return { token: quote.token, price };
}

const trailOf = (amount: number) => ({ unit: 'AMOUNT' as const, amount });

async function openSocket() {
  const socket = new WebSocket(TEST_WS_URL);
  const messages: WsServerMessage[] = [];
  socket.addEventListener('message', (event) => {
    messages.push(WsServerMessage.parse(JSON.parse(String(event.data))));
  });
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  cleanups.push(() => {
    socket.close();
  });
  const send = (message: unknown) => {
    socket.send(JSON.stringify(message));
  };
  const deltas = () =>
    messages.flatMap((m): WsAccountDelta[] => (m.type === 'accountDelta' ? [m] : []));
  return { messages, send, deltas };
}

describe('MSW trailing stops (T08, SPEC-TFC-1 §10.6)', () => {
  it('places, modifies, trails, cancels and triggers a trailing stop', async () => {
    const page = pageLoad();
    const { client, orders } = page;
    const { token, price } = await longPosition(page, '8400000001');

    const placed = await client.call('trailingStopPlace', {
      body: { token, product: 'DELIVERY', trail: trailOf(1_000), exitOrderType: 'MARKET' },
    });
    expect(placed).toMatchObject({
      status: 'TRAILING',
      stopPrice: price - 1_000,
      protectedQty: 10,
    });

    const tighter = await client.call('trailingStopModify', {
      params: { id: placed.id },
      body: { trail: trailOf(500) },
    });
    expect(tighter.stopPrice).toBe(price - 500);
    expect(tighter.seq).toBeGreaterThan(placed.seq);

    // The price rises: the stop follows it and never loosens.
    orders.pinPrice(token, price + 2_000);
    orders.pinPrice(token, price + 1_600);
    const [trailing] = (await client.call('trailingStopsList')).items;
    expect(trailing).toMatchObject({ watermarkPrice: price + 2_000, stopPrice: price + 1_500 });

    const cancelled = await client.call('trailingStopCancel', { params: { id: placed.id } });
    expect(cancelled.status).toBe('CANCELLED');
    const again = await client.callError('trailingStopCancel', { params: { id: placed.id } });
    expect(again.status).toBe(409);
    const missing = await client.callError('trailingStopModify', {
      params: { id: 'ts_nope' },
      body: { trail: trailOf(500) },
    });
    expect(missing.status).toBe(404);

    // A new stop triggers when the price comes back to it, and its exit closes the position.
    const second = await client.call('trailingStopPlace', {
      body: { token, product: 'DELIVERY', trail: trailOf(500), exitOrderType: 'MARKET' },
    });
    orders.pinPrice(token, price + 400);
    const [done] = (await client.call('trailingStopsList')).items;
    expect(done).toMatchObject({ id: second.id, status: 'EXECUTED' });
    const exit = await client.call('orderGet', { params: { id: done?.exitOrderId ?? '' } });
    expect(exit).toMatchObject({ side: 'SELL', qty: 10, status: 'EXECUTED' });
    const { items: positions } = await client.call('positionsList');
    expect(positions.find((p) => p.token === token)?.netQty).toBe(0);
  });

  it('refuses a stop with no position, and closes a position with its stop in one call', async () => {
    const page = pageLoad();
    const { client } = page;
    const { token } = await longPosition(page, '8400000002');
    const refused = await client.callError('trailingStopPlace', {
      body: { token, product: 'INTRADAY', trail: trailOf(500), exitOrderType: 'MARKET' },
    });
    expect(refused.status).toBe(422);

    const stop = await client.call('trailingStopPlace', {
      body: { token, product: 'DELIVERY', trail: trailOf(500), exitOrderType: 'MARKET' },
    });
    const exit = await client.call('positionClose', { body: { token, product: 'DELIVERY' } });
    expect(exit).toMatchObject({ side: 'SELL', qty: 10, status: 'EXECUTED' });
    const [after] = (await client.call('trailingStopsList')).items;
    expect(after).toMatchObject({ id: stop.id, status: 'CANCELLED' });
    const nothing = await client.callError('positionClose', {
      body: { token, product: 'DELIVERY' },
    });
    expect(nothing.status).toBe(422);
  });

  it('keeps a stop across a page load, and it still trails and triggers', async () => {
    const storages = { auth: memoryStorage(), orders: memoryStorage() };
    const first = pageLoad(storages);
    const { token, price } = await longPosition(first, '8400000003');
    const stop = await first.client.call('trailingStopPlace', {
      body: { token, product: 'DELIVERY', trail: trailOf(1_000), exitOrderType: 'MARKET' },
    });
    first.orders.flush();
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    const second = pageLoad(storages);
    carryCookies(first.client, second.client);

    const [restored] = (await second.client.call('trailingStopsList')).items;
    expect(restored).toMatchObject({ id: stop.id, status: 'TRAILING', stopPrice: price - 1_000 });
    second.orders.pinPrice(token, price + 1_000);
    second.orders.pinPrice(token, price - 5);
    const [triggered] = (await second.client.call('trailingStopsList')).items;
    expect(triggered?.status).toBe('EXECUTED');
  });

  it('saves status changes at once and trailing steps at most every 2 s (SPEC-TFC-1 §10.3)', async () => {
    const storages = { auth: memoryStorage(), orders: memoryStorage() };
    const clock = manualTimeouts();
    const page = pageLoad(storages, clock.timeouts);
    const { token, price } = await longPosition(page, '8400000004');
    const stop = await page.client.call('trailingStopPlace', {
      body: { token, product: 'DELIVERY', trail: trailOf(1_000), exitOrderType: 'MARKET' },
    });
    const savedState = () => storages.orders.data.get(ORDERS_MOCK_STORAGE_KEY) ?? '';
    expect(savedState()).toContain(stop.id);

    // Steps of a trailing stop are not status changes: they wait for the throttle.
    const writes = storages.orders.writes;
    for (let step = 1; step <= 5; step += 1) page.orders.pinPrice(token, price + step * 100);
    expect(storages.orders.writes).toBe(writes);
    expect(clock.pending.size).toBe(1);
    clock.fire();
    expect(storages.orders.writes).toBe(writes + 1);
    expect(savedState()).toContain(`"watermarkPrice":${String(price + 500)}`);

    // A hidden tab saves what is left without waiting.
    page.orders.pinPrice(token, price + 600);
    expect(storages.orders.writes).toBe(writes + 1);
    page.orders.flush();
    expect(storages.orders.writes).toBe(writes + 2);
    expect(clock.pending.size).toBe(0);

    // A trigger is a status change: saved at once.
    page.orders.pinPrice(token, price - 1_000);
    expect(storages.orders.writes).toBeGreaterThan(writes + 2);
    expect(savedState()).toContain('"EXECUTED"');
  });
});

describe('MSW account state and accountDelta frames (T08, ADR 0012)', () => {
  it('answers one snapshot at the engine seq, which a client re-reads after a seq gap', async () => {
    const page = pageLoad();
    const { client, orders } = page;
    const { token, price } = await longPosition(page, '8400000005');
    const stop = await client.call('trailingStopPlace', {
      body: { token, product: 'DELIVERY', trail: trailOf(1_000), exitOrderType: 'MARKET' },
    });
    const before = await client.call('accountState');
    const seqs = [
      ...before.orders.map((o) => o.seq ?? 0),
      ...before.trailingStops.map((s) => s.seq),
    ];
    expect(before.seq).toBe(Math.max(...seqs));
    expect(before.trailingStops.map((s) => s.id)).toEqual([stop.id]);
    expect(before.positions.find((p) => p.token === token)?.netQty).toBe(10);

    // Changes the client never saw a frame for: the next snapshot jumps past them, consistently.
    orders.pinPrice(token, price + 300);
    orders.pinPrice(token, price + 700);
    const after = await client.call('accountState');
    expect(after.seq).toBeGreaterThan(before.seq + 1);
    expect(after.trailingStops[0]).toMatchObject({ seq: after.seq, stopPrice: price - 300 });
    expect(after.funds).toEqual(await client.call('fundsSummary'));
  });

  it('sends a tick, the focused depth and the fill it caused in one frame', async () => {
    const page = pageLoad();
    const { client, adapter } = page;
    await login(client, '8400000006');
    const socket = await openSocket();
    socket.send({ v: 1, type: 'focus', symbol: 'INFY', exchange: 'NSE' });
    socket.send({ v: 1, type: 'subscribe', symbols: ['INFY'], exchange: 'NSE' });
    await expect.poll(() => adapter.focusedSymbol()).toBe('INFY');
    const start = await infy(client);
    const limit = start.ltp - 5;
    const placed = await client.call('orderPlace', {
      body: {
        token: start.token,
        side: 'BUY',
        type: 'LIMIT',
        product: 'INTRADAY',
        qty: 2,
        price: limit,
      },
    });

    for (let i = 0; i < 2_000 && (await infy(client)).ltp > limit; i += 1) adapter.tick();
    await expect
      .poll(() => socket.deltas().find((d) => d.orders.some((o) => o.status === 'EXECUTED')))
      .toBeDefined();
    const frame = socket.deltas().find((d) => d.orders.some((o) => o.status === 'EXECUTED'));
    const quote = frame?.quotes.find((q) => q.symbol === 'INFY');
    expect(quote?.ltp).toBeLessThanOrEqual(limit);
    expect(frame?.depth?.symbol).toBe('INFY');
    expect(frame?.orders.find((o) => o.id === placed.id)).toMatchObject({ avgFillPrice: limit });
    expect(frame?.positions.find((p) => p.token === start.token)?.netQty).toBe(2);
    expect(frame?.funds).toBeDefined();
    expect(frame?.seq).toBe((await client.call('accountState')).seq);
    // Frames replace the old messages on a focused connection.
    expect(socket.messages.some((m) => m.type === 'orderUpdate' || m.type === 'quotes')).toBe(
      false,
    );
  }, 30_000);
});
