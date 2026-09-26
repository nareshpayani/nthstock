import { WS_PROTOCOL_VERSION } from '@nthstock/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createHub, FLUSH_INTERVAL_MS, MAX_UPDATES_PER_SECOND } from './hub.js';
import { fakeSocket } from './test/fakeSocket.js';
import { manualTimers } from './test/manualTimers.js';
import { testQuote } from './test/quotes.js';

const subscribe = (symbols: string[], exchange = 'NSE') =>
  JSON.stringify({ v: WS_PROTOCOL_VERSION, type: 'subscribe', symbols, exchange });

describe('hub fan-out', () => {
  it('sends a client subscribed to INFY the INFY quote and never TCS', () => {
    const hub = createHub({ timers: manualTimers() });
    const socket = fakeSocket();
    hub.open(socket).receive(subscribe(['INFY']));
    hub.ingest([testQuote('INFY', 150_000), testQuote('TCS', 300_000)]);
    hub.flush();
    hub.ingest([testQuote('TCS', 300_500)]);
    hub.flush();
    const quotes = socket.json().flatMap((m) => (m.type === 'quotes' ? m.quotes : []));
    expect(quotes.map((q) => q.symbol)).toEqual(['INFY']);
  });

  it('keys subscriptions by exchange', () => {
    const hub = createHub({ timers: manualTimers() });
    const socket = fakeSocket();
    hub.open(socket).receive(subscribe(['SBIN'], 'BSE'));
    hub.ingest([testQuote('SBIN', 80_000), testQuote('SBIN', 80_100, { exchange: 'BSE' })]);
    hub.flush();
    const quotes = socket.json().flatMap((m) => (m.type === 'quotes' ? m.quotes : []));
    expect(quotes.map((q) => `${q.exchange}:${q.ltp}`)).toEqual(['BSE:80100']);
  });

  it('delivers each quote to every subscriber, and nothing after unsubscribe or close', () => {
    const hub = createHub({ timers: manualTimers() });
    const a = fakeSocket();
    const b = fakeSocket();
    const connA = hub.open(a);
    const connB = hub.open(b);
    connA.receive(subscribe(['INFY']));
    connB.receive(subscribe(['INFY', 'TCS']));
    hub.ingest([testQuote('INFY', 150_000), testQuote('TCS', 300_000)]);
    hub.flush();
    expect(a.json()).toHaveLength(1);
    expect(b.json()).toEqual([
      expect.objectContaining({ type: 'quotes', quotes: [expect.anything(), expect.anything()] }),
    ]);
    connA.receive(
      JSON.stringify({ v: WS_PROTOCOL_VERSION, type: 'unsubscribe', symbols: ['INFY'] }),
    );
    connB.closed();
    hub.ingest([testQuote('INFY', 150_100)]);
    hub.flush();
    expect(a.json()).toHaveLength(1);
    expect(b.json()).toHaveLength(1);
    expect(hub.connectionCount()).toBe(1);
    expect(hub.registry.keyCount()).toBe(0);
  });

  it('logs and survives a socket that throws on send', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const hub = createHub({ logger, timers: manualTimers() });
    const socket = fakeSocket();
    hub.open(socket).receive(subscribe(['INFY']));
    socket.send = () => {
      throw new Error('socket gone');
    };
    hub.ingest([testQuote('INFY', 150_000)]);
    expect(() => hub.flush()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith('send failed', { error: 'Error: socket gone' });
  });
});

describe('hub conflation', () => {
  it(`turns 50 ticks/sec into at most ${MAX_UPDATES_PER_SECOND} frames/sec/symbol carrying the latest value`, () => {
    const timers = manualTimers();
    const hub = createHub({ timers });
    const socket = fakeSocket();
    hub.open(socket).receive(subscribe(['INFY', 'TCS']));

    // 3 seconds of 50 ticks/sec for two symbols: tick i arrives at (i - 1) * 20 ms.
    const infyAt = (i: number) => 150_000 + i * 5;
    const tcsAt = (i: number) => 300_000 - i * 5;
    for (let i = 1; i <= 150; i += 1) {
      hub.ingest([testQuote('INFY', infyAt(i))]);
      hub.ingest([testQuote('TCS', tcsAt(i))]);
      timers.advance(20);
    }

    const frames = socket.json().flatMap((m) => (m.type === 'quotes' ? [m] : []));
    // One flush every 250 ms, each a single frame batching both symbols.
    expect(frames).toHaveLength(3_000 / FLUSH_INTERVAL_MS);
    for (const frame of frames) {
      expect(frame.quotes.map((q) => q.symbol).sort()).toEqual(['INFY', 'TCS']);
    }
    for (const symbol of ['INFY', 'TCS'] as const) {
      const perSecond = [0, 0, 0];
      frames.forEach((frame, index) => {
        const second = Math.floor(((index + 1) * FLUSH_INTERVAL_MS - 1) / 1_000);
        if (frame.quotes.some((q) => q.symbol === symbol))
          perSecond[second] = (perSecond[second] ?? 0) + 1;
      });
      expect(Math.max(...perSecond)).toBeLessThanOrEqual(MAX_UPDATES_PER_SECOND);
    }
    // Each frame carries the last tick that arrived before its flush.
    frames.forEach((frame, index) => {
      const flushAt = (index + 1) * FLUSH_INTERVAL_MS;
      const lastTick = Math.floor((flushAt - 1) / 20) + 1;
      expect(frame.quotes.find((q) => q.symbol === 'INFY')?.ltp).toBe(infyAt(lastTick));
      expect(frame.quotes.find((q) => q.symbol === 'TCS')?.ltp).toBe(tcsAt(lastTick));
    });
    hub.close();
    expect(timers.activeCount()).toBe(0);
  });

  it('sends nothing when nothing changed and drops pending quotes on unsubscribe', () => {
    const timers = manualTimers();
    const hub = createHub({ timers });
    const socket = fakeSocket();
    const connection = hub.open(socket);
    connection.receive(subscribe(['INFY']));
    timers.advance(1_000);
    expect(socket.sent).toEqual([]);
    hub.ingest([testQuote('INFY', 150_000)]);
    connection.receive(
      JSON.stringify({ v: WS_PROTOCOL_VERSION, type: 'unsubscribe', symbols: ['INFY'] }),
    );
    timers.advance(FLUSH_INTERVAL_MS);
    expect(socket.sent).toEqual([]);
  });

  it('flushes only connections that were still open', () => {
    const timers = manualTimers();
    const hub = createHub({ timers });
    const socket = fakeSocket();
    const connection = hub.open(socket);
    connection.receive(subscribe(['INFY']));
    hub.ingest([testQuote('INFY', 150_000)]);
    connection.closed();
    timers.advance(FLUSH_INTERVAL_MS);
    expect(socket.sent).toEqual([]);
  });
});
