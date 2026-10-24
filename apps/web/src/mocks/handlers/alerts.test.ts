// @vitest-environment node
import { DEV_OTP, WsServerMessage, type Quote } from '@nthstock/contracts';
import { createScenarioClient, fetchBackend } from '@nthstock/contracts/testing';
import { fixedClock, fromIst } from '@nthstock/utils';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_API_ORIGIN, TEST_WS_URL, createMockServer } from '../node';
import { ALERTS_MOCK_STORAGE_KEY } from './alerts';

/** Monday 28 Sep 2026, 10:00 IST: the market is open. */
const OPEN_MS = fromIst(2026, 9, 28, 10 * 60).getTime();

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

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

function pageLoad(storage?: ReturnType<typeof memoryStorage>) {
  // One storage for auth and alerts, so the same mobile is the same user on the next load.
  const mock = createMockServer({
    clock: fixedClock(OPEN_MS),
    tickIntervalMs: 1_000_000_000,
    flushMs: 20,
    auth: { now: () => OPEN_MS, ...(storage ? { storage } : {}) },
    ...(storage ? { alerts: { storage } } : {}),
  });
  mock.server.listen({ onUnhandledFrame: 'error' });
  cleanups.push(() => {
    mock.server.close();
    mock.alerts.dispose();
    mock.orders.dispose();
    mock.adapter.dispose();
  });
  const client = createScenarioClient(fetchBackend(TEST_API_ORIGIN, fetch));
  return { ...mock, client };
}

async function login(client: ReturnType<typeof pageLoad>['client'], mobile: string) {
  const { requestId } = await client.call('otpRequest', { body: { mobile } });
  await client.call('otpVerify', { body: { requestId, mobile, otp: DEV_OTP } });
}

async function infy(client: ReturnType<typeof pageLoad>['client']): Promise<Quote> {
  const [quote] = (await client.call('marketQuotes', { query: { symbols: 'INFY' } })).items;
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
  return messages;
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i += 1) await new Promise((r) => setTimeout(r, 10));
  expect(check()).toBe(true);
};

describe('MSW price alerts and notifications (NSTOCK-0344)', () => {
  it('creates an alert, fires it on a crossing tick, pushes the notification and lists it', async () => {
    const page = pageLoad();
    await login(page.client, '8300000001');
    const messages = await openSocket();
    const quote = await infy(page.client);
    const level = quote.ltp - (quote.ltp % 5) + 1_000;

    const alert = await page.client.call('priceAlertCreate', {
      body: { symbol: 'INFY', condition: 'ABOVE', price: level, note: 'Breakout' },
    });
    expect(alert).toMatchObject({ status: 'ACTIVE', price: level, note: 'Breakout' });
    const refused = await page.client.callError('priceAlertCreate', {
      body: { symbol: 'INFY', condition: 'BELOW', price: level },
    });
    expect(refused).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_ERROR' } } });

    page.alerts.tick([{ ...quote, ltp: level + 5 }]);

    await until(() => messages.some((m) => m.type === 'notification'));
    const pushed = messages.find((m) => m.type === 'notification');
    expect(pushed).toMatchObject({
      notification: { kind: 'PRICE_ALERT', title: expect.stringMatching(/^INFY crossed above ₹/) },
      alert: { id: alert.id, status: 'TRIGGERED' },
    });
    const list = await page.client.call('notificationsList');
    expect(list.unread).toBe(1);
    expect((await page.client.call('priceAlertsList')).items[0]?.status).toBe('TRIGGERED');
    expect((await page.client.call('notificationsMarkRead', { body: {} })).unread).toBe(0);
  });

  it('cancels an alert once and notifies an executed order', async () => {
    const page = pageLoad();
    await login(page.client, '8300000002');
    const quote = await infy(page.client);
    const alert = await page.client.call('priceAlertCreate', {
      body: { symbol: 'INFY', condition: 'BELOW', price: 100_000 },
    });
    expect((await page.client.call('priceAlertCancel', { params: { id: alert.id } })).status).toBe(
      'CANCELLED',
    );
    expect(
      await page.client.callError('priceAlertCancel', { params: { id: alert.id } }),
    ).toMatchObject({ status: 409 });

    page.orders.pinPrice(quote.token, quote.ltp - (quote.ltp % 5));
    await page.client.call('orderPlace', {
      body: { token: quote.token, side: 'BUY', type: 'MARKET', product: 'DELIVERY', qty: 2 },
    });
    const [fill] = (await page.client.call('notificationsList')).items;
    expect(fill).toMatchObject({ kind: 'ORDER_FILLED', title: 'Order executed' });
    expect(fill?.body).toMatch(/^BUY 2 INFY @ ₹/);
  });

  it('keeps alerts across a page load', async () => {
    const storage = memoryStorage();
    const first = pageLoad(storage);
    await login(first.client, '8300000003');
    await first.client.call('priceAlertCreate', {
      body: { symbol: 'INFY', condition: 'BELOW', price: 100_000 },
    });
    expect(storage.data.has(ALERTS_MOCK_STORAGE_KEY)).toBe(true);
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();

    const second = pageLoad(storage);
    const cookies = first.client.cookies.header() ?? '';
    second.client.cookies.store(cookies.split('; ').map((pair) => `${pair}; Path=/`));
    const { items } = await second.client.call('priceAlertsList');
    expect(items.map((a) => a.status)).toEqual(['ACTIVE']);
  });
});
