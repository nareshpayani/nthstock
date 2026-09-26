// @vitest-environment node
import { createQuoteStore, createWsClient } from '@nthstock/apiClient';
import { WsServerMessage, type WsClientMessage } from '@nthstock/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TEST_WS_URL, createMockServer } from '../node';

// Ticks every 20 ms (50/sec) so conflation has plenty to squash; the market is forced open.
const { server, adapter } = createMockServer({ alwaysOpen: true, tickIntervalMs: 20 });
const sockets: WebSocket[] = [];

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
});
afterAll(() => {
  server.close();
  adapter.dispose();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Frame = { at: number; message: WsServerMessage };

async function connect() {
  const socket = new WebSocket(TEST_WS_URL);
  sockets.push(socket);
  const frames: Frame[] = [];
  socket.addEventListener('message', (event) => {
    frames.push({
      at: performance.now(),
      message: WsServerMessage.parse(JSON.parse(String(event.data))),
    });
  });
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  const send = (message: WsClientMessage | Record<string, unknown> | string) => {
    socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  };
  return { socket, frames, send };
}

const quoteFrames = (frames: Frame[], symbol: string) =>
  frames.filter(
    (f) => f.message.type === 'quotes' && f.message.quotes.some((q) => q.symbol === symbol),
  );

describe('MSW quote stream (T-055)', () => {
  it('streams subscribed symbols at most 4 frames/sec/symbol, and none after unsubscribe', async () => {
    const { frames, send } = await connect();
    send({ v: 1, type: 'subscribe', symbols: ['INFY', 'TCS'], exchange: 'NSE' });
    await sleep(1_600);

    const infy = quoteFrames(frames, 'INFY');
    expect(infy.length).toBeGreaterThanOrEqual(4);
    for (const frame of infy) {
      const inWindow = infy.filter((f) => f.at >= frame.at && f.at < frame.at + 990);
      expect(inWindow.length).toBeLessThanOrEqual(4);
    }
    // Conflated: one quote per symbol per frame, and prices move between frames.
    for (const frame of infy) {
      if (frame.message.type !== 'quotes') continue;
      expect(frame.message.quotes.filter((q) => q.symbol === 'INFY')).toHaveLength(1);
    }
    expect(quoteFrames(frames, 'WIPRO')).toEqual([]);

    send({ v: 1, type: 'unsubscribe', symbols: ['TCS'], exchange: 'NSE' });
    await sleep(30);
    const cutoff = performance.now();
    await sleep(700);
    expect(quoteFrames(frames, 'TCS').filter((f) => f.at > cutoff)).toEqual([]);
    expect(quoteFrames(frames, 'INFY').filter((f) => f.at > cutoff).length).toBeGreaterThan(0);
  });

  it('sends the current quote on subscribe even when the market is closed', async () => {
    const closed = createMockServer({ alwaysOpen: false });
    server.close();
    closed.server.listen({ onUnhandledRequest: 'error' });
    try {
      const { frames, send } = await connect();
      send({ v: 1, type: 'subscribe', symbols: ['SENSEX'], exchange: 'BSE' });
      await sleep(400);
      const sensex = quoteFrames(frames, 'SENSEX');
      expect(sensex.length).toBe(1);
    } finally {
      closed.server.close();
      closed.adapter.dispose();
      server.listen({ onUnhandledRequest: 'error' });
    }
  });

  it('answers ping with pong and reports bad messages', async () => {
    const { frames, send } = await connect();
    send({ v: 1, type: 'ping', id: 7 });
    send('not json');
    send({ v: 2, type: 'ping', id: 1 });
    send({ v: 1, type: 'subscribe', symbols: ['NOPE', 'INFY'], exchange: 'NSE' });
    send({ v: 1, type: 'subscribe', symbols: ['INFY'], exchange: 'NSE' }); // already subscribed
    await sleep(100);
    const replies = frames.map((f) => f.message).filter((m) => m.type !== 'quotes');
    expect(replies).toEqual([
      { v: 1, type: 'pong', id: 7 },
      { v: 1, type: 'error', code: 'INVALID_MESSAGE', message: 'Invalid message' },
      { v: 1, type: 'error', code: 'UNSUPPORTED_VERSION', message: 'Unsupported protocol version' },
      {
        v: 1,
        type: 'error',
        code: 'UNKNOWN_SYMBOL',
        message: 'Unknown symbol on NSE',
        symbols: ['NOPE'],
      },
    ]);
  });

  it('refuses more than 200 symbols per connection', async () => {
    const equities = (await adapter.listInstruments())
      .filter((i) => i.type === 'EQUITY' && i.exchange === 'NSE')
      .map((i) => i.symbol);
    const { frames, send } = await connect();
    send({ v: 1, type: 'subscribe', symbols: equities.slice(0, 200), exchange: 'NSE' });
    send({ v: 1, type: 'subscribe', symbols: equities.slice(200, 202), exchange: 'NSE' });
    await sleep(150);
    const errors = frames.map((f) => f.message).filter((m) => m.type === 'error');
    expect(errors).toEqual([
      expect.objectContaining({ code: 'SUBSCRIPTION_LIMIT', symbols: equities.slice(200, 202) }),
    ]);
  });

  it('feeds the WS client and quote store end to end', async () => {
    const client = createWsClient({ url: TEST_WS_URL });
    const store = createQuoteStore({ source: client });
    let renders = 0;
    const stop = store.subscribe('NIFTY50', 'NSE', () => {
      renders += 1;
    });
    await sleep(700);
    expect(client.status()).toBe('open');
    expect(renders).toBeGreaterThanOrEqual(1);
    expect(store.get('NIFTY50')?.quote.symbol).toBe('NIFTY50');
    stop();
    store.dispose();
    client.close();
  });
});
