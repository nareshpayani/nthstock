// @vitest-environment node
import { DEV_OTP, Order, WsServerMessage, type Quote } from '@nthstock/contracts';
import {
  createScenarioClient,
  fetchBackend,
  type ScenarioClient,
} from '@nthstock/contracts/testing';
import { fixedClock, fromIst } from '@nthstock/utils';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_API_ORIGIN, TEST_WS_URL, createMockServer } from '../node';
import { ORDERS_MOCK_STORAGE_KEY } from './orders';

/** Monday 28 Sep 2026, 10:00 IST: the market is open. */
const OPEN_MS = fromIst(2026, 9, 28, 10 * 60).getTime();

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

type Storage = ReturnType<typeof memoryStorage>;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/**
 * The MSW node server as one page load: the clock stuck at `at`, the market ticking only when the
 * test calls `adapter.tick()`, and optional storages standing in for the browser's.
 */
function pageLoad(storages: { auth?: Storage; orders?: Storage } = {}, at = OPEN_MS) {
  const mock = createMockServer({
    clock: fixedClock(at),
    tickIntervalMs: 1_000_000_000,
    auth: { now: () => at, ...(storages.auth ? { storage: storages.auth } : {}) },
    ...(storages.orders ? { orders: { storage: storages.orders } } : {}),
  });
  mock.server.listen({ onUnhandledRequest: 'error' });
  cleanups.push(() => {
    mock.server.close();
    mock.orders.dispose();
    mock.adapter.dispose();
  });
  const client = createScenarioClient(fetchBackend(TEST_API_ORIGIN, fetch));
  return { ...mock, client };
}

async function login(client: ScenarioClient, mobile: string) {
  const { requestId } = await client.call('otpRequest', { body: { mobile } });
  await client.call('otpVerify', { body: { requestId, mobile, otp: DEV_OTP } });
}

async function infy(client: ScenarioClient): Promise<Quote> {
  const { items } = await client.call('marketQuotes', { query: { symbols: 'INFY' } });
  const [quote] = items;
  if (!quote) throw new Error('INFY has no quote');
  return quote;
}

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
  const orderUpdates = () => messages.flatMap((m) => (m.type === 'orderUpdate' ? [m.order] : []));
  return { socket, orderUpdates };
}

describe('MSW orders (T-132)', () => {
  it('fills a limit order when the mock price crosses it and sends an orderUpdate frame', async () => {
    const { client, adapter } = pageLoad();
    await login(client, '8300000001');
    const { orderUpdates } = await openSocket();
    const start = await infy(client);
    const limit = start.ltp - 5;

    const placed = await client.call('orderPlace', {
      body: {
        token: start.token,
        side: 'BUY',
        type: 'LIMIT',
        product: 'DELIVERY',
        qty: 2,
        price: limit,
      },
    });
    expect(placed.status).toBe('OPEN');
    const funds = await client.call('fundsSummary');
    expect(funds.blocked).toBe(2 * limit);

    // The in-browser market walks until its price comes down to the limit.
    for (let i = 0; i < 2_000 && (await infy(client)).ltp > limit; i += 1) adapter.tick();
    expect((await infy(client)).ltp).toBeLessThanOrEqual(limit);

    await expect.poll(() => orderUpdates().map((o) => o.status)).toContain('EXECUTED');
    const filled = orderUpdates().find((o) => o.status === 'EXECUTED');
    expect(Order.parse(filled)).toMatchObject({ id: placed.id, avgFillPrice: limit, filledQty: 2 });
    const got = await client.call('orderGet', { params: { id: placed.id } });
    expect(got.status).toBe('EXECUTED');
    expect((await client.call('fundsSummary')).blocked).toBe(0);
  }, 30_000);

  it('sends order updates only to the signed-in user, and none after logout', async () => {
    const { client, orders } = pageLoad();
    await login(client, '8300000002');
    const { orderUpdates } = await openSocket();
    const quote = await infy(client);
    const body = {
      token: quote.token,
      side: 'BUY',
      type: 'LIMIT',
      product: 'DELIVERY',
      qty: 1,
    } as const;
    const mine = await client.call('orderPlace', { body: { ...body, price: quote.ltp - 100 } });
    await expect.poll(() => orderUpdates().map((o) => o.id)).toEqual([mine.id]);

    await client.call('logout');
    await login(client, '8300000003');
    const theirs = await client.call('orderPlace', { body: { ...body, price: quote.ltp - 200 } });
    await client.call('logout');
    orders.pinPrice(quote.token, quote.ltp - 200); // fills both orders
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The socket saw the first user's order, then the second user's while they were signed in.
    expect(orderUpdates().map((o) => o.id)).toEqual([mine.id, theirs.id]);
  });

  it('answers a refusal with the shared ApiError mapping', async () => {
    const { client } = pageLoad();
    await login(client, '8300000004');
    const quote = await infy(client);
    const { status, body } = await client.callError('orderPlace', {
      body: {
        token: quote.token,
        side: 'BUY',
        type: 'MARKET',
        product: 'DELIVERY',
        qty: 10_000_000,
      },
    });
    expect(status).toBe(422);
    expect(body.error.code).toBe('INSUFFICIENT_FUNDS');
    expect(Order.parse(body.error.details?.['order']).status).toBe('REJECTED');

    const missing = await client.callError('orderGet', { params: { id: 'pe_nope' } });
    expect(missing.status).toBe(404);
    const cursor = await client.callError('ordersList', { query: { cursor: 'nope' } });
    expect(cursor.status).toBe(400);
  });

  it('keeps orders and funds in sessionStorage across a page load', async () => {
    const storages = { auth: memoryStorage(), orders: memoryStorage() };
    const first = pageLoad(storages);
    await login(first.client, '8300000005');
    const quote = await infy(first.client);
    const open = await first.client.call('orderPlace', {
      body: {
        token: quote.token,
        side: 'BUY',
        type: 'LIMIT',
        product: 'DELIVERY',
        qty: 3,
        price: quote.ltp - 100,
      },
    });
    const funds = await first.client.call('fundsSummary');
    const cookies = first.client.cookies.header() ?? '';
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    expect(storages.orders.data.get(ORDERS_MOCK_STORAGE_KEY)).toContain(open.id);

    const second = pageLoad(storages);
    second.client.cookies.store(cookies.split('; ').map((pair) => `${pair}; Path=/`));
    const page = await second.client.call('ordersList', { query: { status: 'OPEN' } });
    expect(page.items.map((o) => o.id)).toEqual([open.id]);
    expect(await second.client.call('fundsSummary')).toEqual(funds);

    // The restored order still fills on a tick.
    second.orders.pinPrice(quote.token, quote.ltp - 100);
    expect((await second.client.call('orderGet', { params: { id: open.id } })).status).toBe(
      'EXECUTED',
    );
  });

  it('starts fresh when saved state is corrupt or unreadable', async () => {
    const corrupt = memoryStorage();
    corrupt.setItem(ORDERS_MOCK_STORAGE_KEY, JSON.stringify({ v: 1, users: { usr_x: { v: 99 } } }));
    const { client } = pageLoad({ orders: corrupt });
    await login(client, '8300000006');
    expect((await client.call('ordersList')).items).toEqual([]);
    expect(JSON.parse(corrupt.data.get(ORDERS_MOCK_STORAGE_KEY) ?? '')).toMatchObject({
      users: {},
    });

    const broken = {
      data: new Map<string, string>(),
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const again = pageLoad({ orders: broken });
    await login(again.client, '8300000007');
    const quote = await infy(again.client);
    const placed = await again.client.call('orderPlace', {
      body: { token: quote.token, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty: 1 },
    });
    expect(placed.status).toBe('EXECUTED');
  });
});
