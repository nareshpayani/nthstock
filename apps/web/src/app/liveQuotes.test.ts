import { encodeQuoteFrame, instrumentOf, type Quote } from '@nthstock/contracts';
import { describe, expect, it, vi } from 'vitest';
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
});
