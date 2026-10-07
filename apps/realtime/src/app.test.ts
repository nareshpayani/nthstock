import {
  WS_CLOSE_CODES,
  WS_IDLE_TIMEOUT_MS,
  WS_MAX_SUBSCRIPTIONS,
  WS_PROTOCOL_VERSION,
} from '@nthstock/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRealtimeServer, WS_PATH, type RealtimeServer } from './app.js';
import { createMemoryQuoteFeed } from './feeds/feed.js';
import { createMemoryOrderFeed } from './feeds/orderFeed.js';
import { testOrder } from './test/orders.js';
import { quoteFramesOf } from './test/frames.js';
import { manualTimers } from './test/manualTimers.js';
import { testQuote } from './test/quotes.js';
import { connectAuthed, testAuthenticator } from './test/auth.js';
import { connectTestClient } from './test/wsTestClient.js';

let server: RealtimeServer;
let base: string;

beforeEach(async () => {
  server = createRealtimeServer({ authenticate: testAuthenticator() });
  const port = await server.listen(0, '127.0.0.1');
  base = `127.0.0.1:${port}`;
});

afterEach(async () => {
  await server.close();
});

describe('realtime server', () => {
  it('answers GET /health with ok', async () => {
    const response = await fetch(`http://${base}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      connections: 0,
      droppedFrames: 0,
      idleClosed: 0,
    });
  });

  it('has no test controls unless built with them: POST /v1/__test/clock is a 404 (T-162)', async () => {
    const response = await fetch(`http://${base}/v1/__test/clock`, {
      method: 'POST',
      body: JSON.stringify({ at: '2026-09-28T04:30:00.000Z' }),
    });
    expect(response.status).toBe(404);
  });

  it('returns 404 for other paths', async () => {
    const response = await fetch(`http://${base}/nope`);
    expect(response.status).toBe(404);
  });

  it('accepts a WebSocket connection on /ws and answers ping with pong', async () => {
    const client = await connectAuthed(`ws://${base}${WS_PATH}`);
    expect(server.connectionCount()).toBe(1);
    client.send({ v: WS_PROTOCOL_VERSION, type: 'ping', id: 7 });
    expect(await client.next()).toEqual({
      kind: 'json',
      message: { v: WS_PROTOCOL_VERSION, type: 'pong', id: 7 },
    });
    client.close();
    await client.closed;
  });

  it('refuses an upgrade on any other path', async () => {
    await expect(connectTestClient(`ws://${base}/other`)).rejects.toThrow(/404/);
  });

  it('reports malformed, binary and wrong-version messages as errors', async () => {
    const client = await connectAuthed(`ws://${base}${WS_PATH}`);
    client.socket.send('not json');
    expect(await client.next()).toMatchObject({
      message: { type: 'error', code: 'INVALID_MESSAGE' },
    });
    client.socket.send(new Uint8Array([1, 2, 3]));
    expect(await client.next()).toMatchObject({
      message: { type: 'error', code: 'INVALID_MESSAGE', message: expect.stringMatching(/JSON/) },
    });
    client.send({ v: 99, type: 'ping', id: 1 });
    expect(await client.next()).toMatchObject({
      message: { type: 'error', code: 'UNSUPPORTED_VERSION' },
    });
    client.send({ v: WS_PROTOCOL_VERSION, type: 'dance' });
    expect(await client.next()).toMatchObject({
      message: { type: 'error', code: 'INVALID_MESSAGE' },
    });
    client.close();
  });

  it(`answers the ${WS_MAX_SUBSCRIPTIONS + 1}st subscribe with an error`, async () => {
    const client = await connectAuthed(`ws://${base}${WS_PATH}`);
    const symbols = Array.from({ length: WS_MAX_SUBSCRIPTIONS }, (_, i) => `S${i}`);
    client.send({ v: WS_PROTOCOL_VERSION, type: 'subscribe', symbols, exchange: 'NSE' });
    expect(await client.drain()).toEqual([]);
    client.send({ v: WS_PROTOCOL_VERSION, type: 'subscribe', symbols: ['INFY'] });
    expect(await client.next()).toEqual({
      kind: 'json',
      message: {
        v: WS_PROTOCOL_VERSION,
        type: 'error',
        code: 'SUBSCRIPTION_LIMIT',
        message: `A connection may subscribe to at most ${WS_MAX_SUBSCRIPTIONS} symbols`,
        symbols: ['INFY'],
      },
    });
    expect(server.registry.keyCount()).toBe(WS_MAX_SUBSCRIPTIONS);
    client.close();
  });

  it('unsubscribes, and a disconnect clears the connection from both maps', async () => {
    const client = await connectAuthed(`ws://${base}${WS_PATH}`);
    client.send({ v: WS_PROTOCOL_VERSION, type: 'subscribe', symbols: ['INFY', 'TCS'] });
    client.send({ v: WS_PROTOCOL_VERSION, type: 'unsubscribe', symbols: ['TCS'] });
    await client.drain();
    expect(server.registry.keyCount()).toBe(1);
    expect(server.registry.connectionCount()).toBe(1);
    client.close();
    await client.closed;
    await vi.waitFor(() => {
      expect(server.connectionCount()).toBe(0);
    });
    expect(server.registry.keyCount()).toBe(0);
    expect(server.registry.connectionCount()).toBe(0);
  });

  it('closes open connections when the server closes', async () => {
    const client = await connectAuthed(`ws://${base}${WS_PATH}`);
    await server.close();
    expect((await client.closed).code).toBe(1006);
    server = createRealtimeServer({ authenticate: testAuthenticator() }); // afterEach closes a fresh, never-listening server
  });
});

describe('realtime server with a feed', () => {
  it('sends a client subscribed to INFY only INFY quotes, and closes the feed on close', async () => {
    const feed = createMemoryQuoteFeed();
    const own = createRealtimeServer({
      authenticate: testAuthenticator(),
      feed,
      timers: manualTimers(),
    });
    const port = await own.listen(0, '127.0.0.1');
    const client = await connectAuthed(`ws://127.0.0.1:${port}${WS_PATH}`);
    client.send({ v: WS_PROTOCOL_VERSION, type: 'subscribe', symbols: ['INFY'] });
    await client.drain();
    feed.emit([testQuote('TCS', 300_000), testQuote('INFY', 150_000)]);
    feed.emit([testQuote('TCS', 300_100)]);
    own.flush();
    const frames = await client.drain();
    expect(frames.map((f) => f.kind)).toEqual(['json', 'binary']);
    expect(quoteFramesOf(frames)).toEqual([[testQuote('INFY', 150_000)]]);
    await own.close();
    expect(feed.closed).toBe(true);
  });
});

describe('realtime server idle timeout', () => {
  it('closes an idle WebSocket with the idle close code', async () => {
    let now = 0;
    const own = createRealtimeServer({
      authenticate: testAuthenticator(),
      timers: manualTimers(),
      now: () => now,
    });
    const port = await own.listen(0, '127.0.0.1');
    const client = await connectAuthed(`ws://127.0.0.1:${port}${WS_PATH}`);
    now = 20_000;
    own.heartbeat(); // pings; the client answers with a pong automatically
    now = WS_IDLE_TIMEOUT_MS + 20_000;
    await client.drain(); // activity at 80 s
    now = WS_IDLE_TIMEOUT_MS + 79_999;
    own.heartbeat();
    expect(own.connectionCount()).toBe(1);
    now = WS_IDLE_TIMEOUT_MS + 80_000;
    own.heartbeat();
    expect(await client.closed).toEqual({
      code: WS_CLOSE_CODES.idleTimeout,
      reason: 'idle timeout',
    });
    await own.close();
  });
});

describe('private order channel (T-133)', () => {
  it("user A receives their fill and never user B's", async () => {
    const orderFeed = createMemoryOrderFeed();
    const own = createRealtimeServer({ authenticate: testAuthenticator(), orderFeed });
    const port = await own.listen(0, '127.0.0.1');
    const url = `ws://127.0.0.1:${port}${WS_PATH}`;
    const alice = await connectAuthed(url, 'usr_alice');
    const bob = await connectAuthed(url, 'usr_bob');
    await alice.drain();
    await bob.drain();
    expect(orderFeed.watching('usr_alice')).toBe(true);
    expect(orderFeed.watching('usr_bob')).toBe(true);

    orderFeed.emit('usr_bob', testOrder('o_bob'));
    orderFeed.emit('usr_alice', testOrder('o_alice'));

    expect(await alice.drain()).toEqual([
      {
        kind: 'json',
        message: { v: WS_PROTOCOL_VERSION, type: 'orderUpdate', order: testOrder('o_alice') },
      },
    ]);
    expect(await bob.drain()).toEqual([
      {
        kind: 'json',
        message: { v: WS_PROTOCOL_VERSION, type: 'orderUpdate', order: testOrder('o_bob') },
      },
    ]);

    alice.close();
    await alice.closed;
    await vi.waitFor(() => {
      expect(orderFeed.watching('usr_alice')).toBe(false);
    });
    expect(orderFeed.watching('usr_bob')).toBe(true);
    bob.close();
    await own.close();
  });
});

describe('realtime server with test controls (T-162)', () => {
  it('sets the test clock from POST /v1/__test/clock and rejects a bad body', async () => {
    let offset = 0;
    const now = () => Date.now() + offset;
    const controlled = createRealtimeServer({
      authenticate: testAuthenticator(),
      testControls: {
        setTime: (at) => {
          offset = Date.parse(at) - Date.now();
        },
        now,
      },
    });
    const port = await controlled.listen(0, '127.0.0.1');
    try {
      const url = `http://127.0.0.1:${String(port)}/v1/__test/clock`;
      const ok = await fetch(url, {
        method: 'POST',
        body: JSON.stringify({ at: '2030-01-07T04:30:00.000Z' }),
      });
      expect(ok.status).toBe(200);
      const { now: reported } = (await ok.json()) as { now: string };
      expect(reported.slice(0, 13)).toBe('2030-01-07T04');
      expect(new Date(now()).toISOString().slice(0, 13)).toBe('2030-01-07T04');
      for (const body of ['{"at":"soon"}', 'not json', 'x'.repeat(2048)]) {
        expect((await fetch(url, { method: 'POST', body })).status).toBe(400);
      }
      expect((await fetch(url)).status).toBe(404);
    } finally {
      await controlled.close();
    }
  });
});
