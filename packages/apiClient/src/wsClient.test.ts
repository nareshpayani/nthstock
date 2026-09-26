import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeWebSocket, quote } from './test/fakes.js';
import { backoffDelay, createWsClient, globalTimers, type WsStatus } from './wsClient.js';

const flushMicrotasks = () => Promise.resolve();

function makeClient(overrides: Partial<Parameters<typeof createWsClient>[0]> = {}) {
  return createWsClient({
    url: 'ws://quotes.test/ws',
    WebSocket: FakeWebSocket,
    random: () => 0.5,
    heartbeatMs: 1_000,
    ...overrides,
  });
}

beforeEach(() => {
  FakeWebSocket.reset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ws client subscriptions', () => {
  it('two subscribers to INFY send one subscribe; the last release sends unsubscribe', async () => {
    const client = makeClient();
    const a = client.subscribe('INFY');
    const b = client.subscribe('INFY');
    const socket = FakeWebSocket.last();
    expect(FakeWebSocket.instances).toHaveLength(1);
    socket.open();
    await flushMicrotasks();
    expect(socket.sent).toEqual([{ v: 1, type: 'subscribe', symbols: ['INFY'], exchange: 'NSE' }]);

    a();
    a(); // releasing twice is harmless
    await flushMicrotasks();
    expect(socket.sent).toHaveLength(1);
    b();
    await flushMicrotasks();
    expect(socket.sent.at(-1)).toEqual({
      v: 1,
      type: 'unsubscribe',
      symbols: ['INFY'],
      exchange: 'NSE',
    });
    expect(client.subscriptionCount()).toBe(0);
  });

  it('coalesces changes in one task into one frame per exchange', async () => {
    const client = makeClient();
    client.subscribe('NIFTY50');
    const socket = FakeWebSocket.last();
    socket.open();
    await flushMicrotasks();
    socket.sent.length = 0;

    client.subscribe('INFY');
    client.subscribe('TCS');
    client.subscribe('SENSEX', 'BSE');
    const gone = client.subscribe('WIPRO');
    gone(); // subscribed and released in the same task: nothing sent
    await flushMicrotasks();
    expect(socket.sent).toEqual([
      { v: 1, type: 'subscribe', symbols: ['INFY', 'TCS'], exchange: 'NSE' },
      { v: 1, type: 'subscribe', symbols: ['SENSEX'], exchange: 'BSE' },
    ]);
  });

  it('splits more than 200 symbols across frames', async () => {
    const client = makeClient();
    for (let i = 0; i < 250; i += 1) client.subscribe(`S${String(i)}`);
    FakeWebSocket.last().open();
    const frames = FakeWebSocket.last().sent as { symbols: string[] }[];
    expect(frames.map((f) => f.symbols.length)).toEqual([200, 50]);
  });

  it('delivers quote frames to quote listeners and every message to message listeners', () => {
    const client = makeClient();
    const onQuotes = vi.fn();
    const onMessage = vi.fn();
    const stopQuotes = client.onQuotes(onQuotes);
    client.onMessage(onMessage);
    client.subscribe('INFY');
    const socket = FakeWebSocket.last();
    socket.open();

    const q = quote('INFY', 151000);
    socket.receive({ v: 1, type: 'quotes', quotes: [q] });
    socket.receive({ v: 1, type: 'error', code: 'UNKNOWN_SYMBOL', message: 'Unknown' });
    socket.receive('not json');
    socket.receive({ v: 1, type: 'mystery' });
    socket.onmessage?.({ data: new ArrayBuffer(4) });
    expect(onQuotes).toHaveBeenCalledExactlyOnceWith([q]);
    expect(onMessage).toHaveBeenCalledTimes(2);

    stopQuotes();
    socket.receive({ v: 1, type: 'quotes', quotes: [q] });
    expect(onQuotes).toHaveBeenCalledTimes(1);
  });
});

describe('ws client reconnect', () => {
  it('reconnects with backoff and resends every subscription', async () => {
    const statuses: WsStatus[] = [];
    const client = makeClient({ url: () => 'ws://quotes.test/ws' });
    client.onStatus((s) => statuses.push(s));
    client.subscribe('INFY');
    client.subscribe('SENSEX', 'BSE');
    const first = FakeWebSocket.last();
    first.open();
    await flushMicrotasks();
    expect(client.status()).toBe('open');

    first.drop();
    expect(client.status()).toBe('reconnecting');
    // attempt 0 with random 0.5: 500/2 + 0.5 * 500/2 = 375 ms
    vi.advanceTimersByTime(374);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    const second = FakeWebSocket.last();
    second.drop(); // fails before opening: next delay doubles
    vi.advanceTimersByTime(749);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    const third = FakeWebSocket.last();
    third.open();
    expect(third.sent).toEqual([
      { v: 1, type: 'subscribe', symbols: ['INFY'], exchange: 'NSE' },
      { v: 1, type: 'subscribe', symbols: ['SENSEX'], exchange: 'BSE' },
    ]);
    expect(statuses).toEqual(['connecting', 'open', 'reconnecting', 'open']);

    // A later drop starts again from the first step.
    third.drop();
    vi.advanceTimersByTime(375);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it('retries when the constructor throws', () => {
    let fail = true;
    class Flaky extends FakeWebSocket {
      constructor(url: string) {
        if (fail) throw new Error('blocked');
        super(url);
      }
    }
    const client = makeClient({ WebSocket: Flaky });
    client.subscribe('INFY');
    expect(client.status()).toBe('reconnecting');
    fail = false;
    vi.advanceTimersByTime(375);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('close() stops reconnecting', () => {
    const client = makeClient();
    client.subscribe('INFY');
    const socket = FakeWebSocket.last();
    socket.open();
    client.close();
    expect(socket.closedWith).toEqual({ code: 1000, reason: 'client closed' });
    expect(client.status()).toBe('closed');
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    client.subscribe('TCS');
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('close() cancels a pending reconnect', () => {
    const client = makeClient();
    client.subscribe('INFY');
    FakeWebSocket.last().drop();
    client.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('ws client heartbeat', () => {
  it('pings on an interval and reconnects when a pong does not come back', () => {
    const client = makeClient();
    client.subscribe('INFY');
    const socket = FakeWebSocket.last();
    socket.open();
    socket.sent.length = 0;

    vi.advanceTimersByTime(1_000);
    expect(socket.sent).toEqual([{ v: 1, type: 'ping', id: 1 }]);
    socket.receive({ v: 1, type: 'pong', id: 1 });
    vi.advanceTimersByTime(1_000);
    expect(socket.sent.at(-1)).toEqual({ v: 1, type: 'ping', id: 2 });
    expect(socket.closedWith).toBeNull();

    // No pong for ping 2: the next beat closes the socket and schedules a reconnect.
    vi.advanceTimersByTime(1_000);
    expect(socket.closedWith).toEqual({ code: 4000, reason: 'heartbeat timeout' });
    expect(client.status()).toBe('reconnecting');
    vi.advanceTimersByTime(375);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});

describe('backoffDelay', () => {
  it('doubles per attempt up to the cap, with half of each step random', () => {
    expect(backoffDelay(0, () => 0)).toBe(250);
    expect(backoffDelay(0, () => 1)).toBe(500);
    expect(backoffDelay(3, () => 0)).toBe(2_000);
    expect(backoffDelay(20, () => 1)).toBe(30_000);
    expect(backoffDelay(20, () => 0)).toBe(15_000);
  });
});

describe('globalTimers', () => {
  it('delegates to the current global timers', () => {
    const fn = vi.fn();
    const t = globalTimers.setTimeout(fn, 10);
    globalTimers.clearTimeout(t);
    const i = globalTimers.setInterval(fn, 10);
    vi.advanceTimersByTime(25);
    globalTimers.clearInterval(i);
    vi.advanceTimersByTime(25);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('default WebSocket', () => {
  it('uses the global WebSocket, looked up at connect time', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const client = createWsClient({ url: 'ws://quotes.test/ws' });
    client.subscribe('INFY');
    expect(FakeWebSocket.last().url).toBe('ws://quotes.test/ws');
    vi.unstubAllGlobals();
  });
});
