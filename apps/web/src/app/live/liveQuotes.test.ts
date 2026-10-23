import { encodeQuoteFrame, instrumentOf, type Quote } from '@nthstock/contracts';
import { describe, expect, it, vi } from 'vitest';
import { testOrder } from '@/test/orders';
import { createLiveQuotes } from './liveQuotes';

describe('createLiveQuotes', () => {
  it('connects the WS client lazily to the resolved URL and feeds the quote store', () => {
    const urls: string[] = [];
    class FakeSocket {
      readyState = 0;
      onopen = null;
      onmessage = null;
      onclose = null;
      onerror = null;
      constructor(url: string) {
        urls.push(url);
      }
      send() {}
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeSocket);
    const { wsClient, quoteStore } = createLiveQuotes(
      { wsUrl: null },
      { protocol: 'https:', host: 'nthstock.test' },
    );
    expect(urls).toEqual([]);
    const stop = quoteStore.subscribe('NIFTY50', 'NSE', () => undefined);
    expect(urls).toEqual(['wss://nthstock.test/ws']);
    expect(wsClient.subscriptionCount()).toBe(1);
    stop();
    wsClient.close();
    vi.unstubAllGlobals();
  });

  it('in api mode, turns apps/realtime binary quote frames into live prices', () => {
    const sockets: {
      onopen: (() => void) | null;
      onmessage: ((e: { data: unknown }) => void) | null;
      binaryType: string;
      readyState: number;
    }[] = [];
    class RealtimeSocket {
      readyState = 0;
      binaryType = 'blob';
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onclose = null;
      onerror = null;
      constructor() {
        sockets.push(this);
      }
      send() {}
      close() {}
    }
    vi.stubGlobal('WebSocket', RealtimeSocket);
    const { wsClient, quoteStore } = createLiveQuotes(
      { wsUrl: null },
      { protocol: 'http:', host: 'localhost:5173' },
    );
    const listener = vi.fn();
    quoteStore.subscribe('INFY', 'NSE', listener);
    const socket = sockets[0];
    if (!socket) throw new Error('no socket');
    expect(socket.binaryType).toBe('arraybuffer');
    socket.readyState = 1;
    socket.onopen?.();

    const quote: Quote = {
      token: 408065,
      symbol: 'INFY',
      exchange: 'NSE',
      ltp: 151_000,
      change: 1_000,
      changeBp: 67,
      open: 150_000,
      high: 151_000,
      low: 149_500,
      prevClose: 150_000,
      volume: 12_345,
      ts: '2026-09-25T04:00:00.000Z',
    };
    socket.onmessage?.({
      data: JSON.stringify({ v: 1, type: 'instruments', instruments: [instrumentOf(quote)] }),
    });
    socket.onmessage?.({ data: encodeQuoteFrame([quote]).buffer });
    quoteStore.flush();
    expect(quoteStore.get('INFY', 'NSE')?.quote).toEqual(quote);
    expect(listener).toHaveBeenCalledTimes(1);
    wsClient.close();
    vi.unstubAllGlobals();
  });

  it('delivers orderUpdate messages to order listeners and connects without a symbol', () => {
    const sockets: {
      onopen: (() => void) | null;
      onmessage: ((e: { data: unknown }) => void) | null;
      readyState: number;
    }[] = [];
    class OrderSocket {
      readyState = 0;
      binaryType = 'blob';
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onclose = null;
      onerror = null;
      constructor() {
        sockets.push(this);
      }
      send() {}
      close() {}
    }
    vi.stubGlobal('WebSocket', OrderSocket);
    const { wsClient, orderUpdates } = createLiveQuotes(
      { wsUrl: null },
      { protocol: 'http:', host: 'localhost:5173' },
    );
    const listener = vi.fn();
    const orderFixture = testOrder({ status: 'EXECUTED', filledQty: 10, avgFillPrice: 151_000 });
    const stop = orderUpdates.onOrderUpdate(listener);
    expect(sockets).toHaveLength(0);
    orderUpdates.connect();
    const socket = sockets[0];
    if (!socket) throw new Error('no socket');
    socket.readyState = 1;
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ v: 1, type: 'pong', id: 1 }) });
    socket.onmessage?.({
      data: JSON.stringify({ v: 1, type: 'orderUpdate', order: orderFixture }),
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(orderFixture);
    stop();
    socket.onmessage?.({
      data: JSON.stringify({ v: 1, type: 'orderUpdate', order: orderFixture }),
    });
    expect(listener).toHaveBeenCalledTimes(1);
    wsClient.close();
    vi.unstubAllGlobals();
  });

  it('in msw mode, opens the socket only once the mock worker is ready (T-169)', async () => {
    const urls: string[] = [];
    class FakeSocket {
      readyState = 0;
      onopen = null;
      onmessage = null;
      onclose = null;
      onerror = null;
      constructor(url: string) {
        urls.push(url);
      }
      send() {}
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeSocket);
    let markReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const { wsClient, quoteStore, orderUpdates } = createLiveQuotes(
      { wsUrl: null },
      { protocol: 'http:', host: '127.0.0.1:4173' },
      ready,
    );
    const stop = quoteStore.subscribe('INFY', 'NSE', () => undefined);
    orderUpdates.connect();
    await Promise.resolve();
    expect(urls).toEqual([]);
    markReady();
    await ready;
    await Promise.resolve();
    expect(urls).toEqual(['ws://127.0.0.1:4173/ws']);
    expect(wsClient.subscriptionCount()).toBe(1);
    stop();
    wsClient.close();
    vi.unstubAllGlobals();
  });
});

describe('createLiveQuotes with a trading store (T10)', () => {
  it('creates the store only when asked, and turns account frames into order updates', () => {
    const sockets: {
      onopen: (() => void) | null;
      onmessage: ((e: { data: unknown }) => void) | null;
      readyState: number;
      sent: unknown[];
    }[] = [];
    class FrameSocket {
      readyState = 0;
      binaryType = 'blob';
      sent: unknown[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onclose = null;
      onerror = null;
      constructor() {
        sockets.push(this);
      }
      send(data: string) {
        this.sent.push(JSON.parse(data));
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', FrameSocket);
    const location = { protocol: 'http:', host: 'localhost:5173' };
    expect(createLiveQuotes({ wsUrl: null }, location).tradingStore).toBeUndefined();

    const { wsClient, orderUpdates, tradingStore } = createLiveQuotes(
      { wsUrl: null },
      location,
      undefined,
      { loadState: () => new Promise(() => undefined) },
    );
    expect(tradingStore?.getState().status).toBe('idle');
    const listener = vi.fn();
    orderUpdates.onOrderUpdate(listener);
    tradingStore?.focus('INFY');
    const socket = sockets.at(-1);
    if (!socket) throw new Error('no socket');
    socket.readyState = 1;
    socket.onopen?.();
    expect(socket.sent).toContainEqual({ v: 1, type: 'focus', symbol: 'INFY', exchange: 'NSE' });
    const filled = testOrder({ status: 'EXECUTED', filledQty: 10, avgFillPrice: 151_000, seq: 4 });
    socket.onmessage?.({
      data: JSON.stringify({
        v: 1,
        type: 'accountDelta',
        seq: 4,
        at: '2026-09-28T04:30:00.000Z',
        quotes: [],
        orders: [filled],
        positions: [],
        trailingStops: [],
      }),
    });
    expect(listener).toHaveBeenCalledWith(filled);
    wsClient.close();
    vi.unstubAllGlobals();
  });
});
