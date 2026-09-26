import { createApiClient, createQuoteStore, createWsClient } from '@nthstock/apiClient';
import type { Exchange, Quote } from '@nthstock/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testQuote } from '@/test/quotes';
import { restSnapshot, startVisibilitySync, type VisibilityDocument } from './visibilitySync';

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  binaryType = 'blob';
  sent: { type: string; symbols?: string[]; exchange?: string }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as FakeSocket['sent'][number]);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function fakeDocument(initial: DocumentVisibilityState = 'visible') {
  const target = new EventTarget();
  const doc = {
    visibilityState: initial,
    addEventListener: (type: string, listener: () => void) =>
      target.addEventListener(type, listener),
    removeEventListener: (type: string, listener: () => void) =>
      target.removeEventListener(type, listener),
    set(state: DocumentVisibilityState) {
      doc.visibilityState = state;
      target.dispatchEvent(new Event('visibilitychange'));
    },
  };
  return doc satisfies VisibilityDocument;
}

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

function setup(initial: DocumentVisibilityState = 'visible') {
  const frames: (() => void)[] = [];
  const wsClient = createWsClient({
    url: 'ws://localhost/ws',
    WebSocket: FakeSocket,
    random: () => 0,
    heartbeatMs: 60_000,
    backoff: { initialMs: 10, maxMs: 10 },
  });
  const quoteStore = createQuoteStore({ source: wsClient, schedule: (f) => frames.push(f) });
  const snapshots: { symbols: string[]; exchange: Exchange }[] = [];
  let snapshotQuotes: Quote[] = [];
  const fetchSnapshot = vi.fn((symbols: string[], exchange: Exchange) => {
    snapshots.push({ symbols, exchange });
    return Promise.resolve(snapshotQuotes.filter((q) => symbols.includes(q.symbol)));
  });
  const doc = fakeDocument(initial);
  const stop = startVisibilitySync({ document: doc, quoteStore, wsClient, fetchSnapshot });
  return {
    wsClient,
    quoteStore,
    doc,
    stop,
    snapshots,
    fetchSnapshot,
    setSnapshot: (quotes: Quote[]) => {
      snapshotQuotes = quotes;
    },
    runFrame: () => frames.splice(0).forEach((f) => f()),
  };
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('startVisibilitySync', () => {
  it('a hidden tab unsubscribes all but the active watchlist; focus resubscribes and resyncs from the snapshot', async () => {
    const t = setup();
    t.quoteStore.subscribe('INFY', 'NSE', () => undefined);
    t.quoteStore.subscribe('TCS', 'NSE', () => undefined);
    t.quoteStore.subscribe('SENSEX', 'BSE', () => undefined);
    t.quoteStore.pin('INFY', 'NSE'); // on the active watchlist
    const socket = FakeSocket.all[0];
    if (!socket) throw new Error('no socket');
    socket.open();
    await settle();
    socket.sent.length = 0;

    t.doc.set('hidden');
    await settle();
    expect(socket.sent).toEqual([
      { v: 1, type: 'unsubscribe', symbols: ['TCS'], exchange: 'NSE' },
      { v: 1, type: 'unsubscribe', symbols: ['SENSEX'], exchange: 'BSE' },
    ]);
    expect(t.fetchSnapshot).not.toHaveBeenCalled();

    socket.sent.length = 0;
    t.setSnapshot([
      testQuote('INFY', 151_000, { ts: '2026-09-25T05:00:00.000Z' }),
      testQuote('TCS', 301_000, { ts: '2026-09-25T05:00:00.000Z' }),
      testQuote('SENSEX', 8_100_000, { exchange: 'BSE', ts: '2026-09-25T05:00:00.000Z' }),
    ]);
    t.doc.set('visible');
    await settle();
    expect(socket.sent).toEqual([
      { v: 1, type: 'subscribe', symbols: ['TCS'], exchange: 'NSE' },
      { v: 1, type: 'subscribe', symbols: ['SENSEX'], exchange: 'BSE' },
    ]);
    expect(t.snapshots).toEqual([
      { symbols: ['INFY', 'TCS'], exchange: 'NSE' },
      { symbols: ['SENSEX'], exchange: 'BSE' },
    ]);
    t.runFrame();
    expect(t.quoteStore.get('TCS', 'NSE')?.quote.ltp).toBe(301_000);
    expect(t.quoteStore.get('SENSEX', 'BSE')?.quote.ltp).toBe(8_100_000);
    t.stop();
    t.wsClient.close();
  });

  it('resyncs from the snapshot after a reconnect, not on the first connect', async () => {
    const t = setup();
    t.quoteStore.subscribe('INFY', 'NSE', () => undefined);
    FakeSocket.all[0]?.open();
    await settle();
    expect(t.fetchSnapshot).not.toHaveBeenCalled();
    FakeSocket.all[0]?.drop();
    vi.advanceTimersByTime(10);
    FakeSocket.all[1]?.open();
    await settle();
    expect(t.snapshots).toEqual([{ symbols: ['INFY'], exchange: 'NSE' }]);
    t.stop();
    t.wsClient.close();
  });

  it('starts paused in a hidden tab, splits big snapshots, survives failures and stops cleanly', async () => {
    const t = setup('hidden');
    const symbols = Array.from({ length: 60 }, (_, i) => `S${String(i)}`);
    for (const symbol of symbols) t.quoteStore.subscribe(symbol, 'NSE', () => undefined);
    expect(t.wsClient.subscriptionCount()).toBe(0);
    t.fetchSnapshot.mockRejectedValueOnce(new Error('offline'));
    t.doc.set('visible');
    await settle();
    expect(t.fetchSnapshot.mock.calls.map(([symbols]) => symbols.length)).toEqual([50, 10]);
    expect(t.wsClient.subscriptionCount()).toBe(60);
    t.stop();
    t.doc.set('hidden');
    expect(t.wsClient.subscriptionCount()).toBe(60);
    t.wsClient.close();
  });
});

describe('restSnapshot', () => {
  it('reads GET /v1/market/quotes for one exchange', async () => {
    const quote = testQuote('INFY', 150_000);
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(JSON.stringify({ items: [quote] }), { status: 200 })),
    );
    const api = createApiClient({ fetch });
    await expect(restSnapshot(api)(['INFY', 'TCS'], 'NSE')).resolves.toEqual([quote]);
    expect(fetch.mock.calls[0]?.[0]).toBe('/v1/market/quotes?symbols=INFY%2CTCS&exchange=NSE');
  });
});
