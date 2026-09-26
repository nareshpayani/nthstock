import { WS_PROTOCOL_VERSION } from '@nthstock/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createHub } from './hub.js';
import { fakeSocket } from './test/fakeSocket.js';
import { testQuote } from './test/quotes.js';

const subscribe = (symbols: string[], exchange = 'NSE') =>
  JSON.stringify({ v: WS_PROTOCOL_VERSION, type: 'subscribe', symbols, exchange });

describe('hub fan-out', () => {
  it('sends a client subscribed to INFY the INFY quote and never TCS', () => {
    const hub = createHub();
    const socket = fakeSocket();
    hub.open(socket).receive(subscribe(['INFY']));
    hub.ingest([testQuote('INFY', 150_000), testQuote('TCS', 300_000)]);
    hub.ingest([testQuote('TCS', 300_500)]);
    const quotes = socket.json().flatMap((m) => (m.type === 'quotes' ? m.quotes : []));
    expect(quotes.map((q) => q.symbol)).toEqual(['INFY']);
  });

  it('keys subscriptions by exchange', () => {
    const hub = createHub();
    const socket = fakeSocket();
    hub.open(socket).receive(subscribe(['SBIN'], 'BSE'));
    hub.ingest([testQuote('SBIN', 80_000), testQuote('SBIN', 80_100, { exchange: 'BSE' })]);
    const quotes = socket.json().flatMap((m) => (m.type === 'quotes' ? m.quotes : []));
    expect(quotes.map((q) => `${q.exchange}:${q.ltp}`)).toEqual(['BSE:80100']);
  });

  it('delivers each quote to every subscriber, and nothing after unsubscribe or close', () => {
    const hub = createHub();
    const a = fakeSocket();
    const b = fakeSocket();
    const connA = hub.open(a);
    const connB = hub.open(b);
    connA.receive(subscribe(['INFY']));
    connB.receive(subscribe(['INFY', 'TCS']));
    hub.ingest([testQuote('INFY', 150_000), testQuote('TCS', 300_000)]);
    expect(a.json()).toHaveLength(1);
    expect(b.json()).toEqual([
      expect.objectContaining({ type: 'quotes', quotes: [expect.anything(), expect.anything()] }),
    ]);
    connA.receive(
      JSON.stringify({ v: WS_PROTOCOL_VERSION, type: 'unsubscribe', symbols: ['INFY'] }),
    );
    connB.closed();
    hub.ingest([testQuote('INFY', 150_100)]);
    expect(a.json()).toHaveLength(1);
    expect(b.json()).toHaveLength(1);
    expect(hub.connectionCount()).toBe(1);
    expect(hub.registry.keyCount()).toBe(0);
  });

  it('logs and survives a socket that throws on send', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const hub = createHub({ logger });
    const socket = fakeSocket();
    hub.open(socket).receive(subscribe(['INFY']));
    socket.send = () => {
      throw new Error('socket gone');
    };
    expect(() => hub.ingest([testQuote('INFY', 150_000)])).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith('send failed', { error: 'Error: socket gone' });
  });
});
