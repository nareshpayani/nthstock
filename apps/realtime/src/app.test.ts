import { WS_MAX_SUBSCRIPTIONS, WS_PROTOCOL_VERSION } from '@nthstock/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRealtimeServer, WS_PATH, type RealtimeServer } from './app.js';
import { createMemoryQuoteFeed } from './feed.js';
import { quoteFramesOf } from './test/frames.js';
import { manualTimers } from './test/manualTimers.js';
import { testQuote } from './test/quotes.js';
import { connectTestClient } from './test/wsTestClient.js';

let server: RealtimeServer;
let base: string;

beforeEach(async () => {
  server = createRealtimeServer();
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
    expect(await response.json()).toEqual({ status: 'ok', connections: 0 });
  });

  it('returns 404 for other paths', async () => {
    const response = await fetch(`http://${base}/nope`);
    expect(response.status).toBe(404);
  });

  it('accepts a WebSocket connection on /ws and answers ping with pong', async () => {
    const client = await connectTestClient(`ws://${base}${WS_PATH}`);
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
    const client = await connectTestClient(`ws://${base}${WS_PATH}`);
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
    const client = await connectTestClient(`ws://${base}${WS_PATH}`);
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
    const client = await connectTestClient(`ws://${base}${WS_PATH}`);
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
    const client = await connectTestClient(`ws://${base}${WS_PATH}`);
    await server.close();
    expect((await client.closed).code).toBe(1006);
    server = createRealtimeServer(); // afterEach closes a fresh, never-listening server
  });
});

describe('realtime server with a feed', () => {
  it('sends a client subscribed to INFY only INFY quotes, and closes the feed on close', async () => {
    const feed = createMemoryQuoteFeed();
    const own = createRealtimeServer({ feed, timers: manualTimers() });
    const port = await own.listen(0, '127.0.0.1');
    const client = await connectTestClient(`ws://127.0.0.1:${port}${WS_PATH}`);
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
