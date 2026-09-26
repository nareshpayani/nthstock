import type { Quote } from '@nthstock/contracts';
import type { WebSocketLike } from '../wsClient.js';

/** A controllable WebSocket stand-in: tests open, message and close it by hand. */
export class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];
  static reset() {
    FakeWebSocket.instances = [];
  }
  static last(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error('no socket created');
    return socket;
  }

  readyState = 0;
  readonly sent: unknown[] = [];
  closedWith: { code?: number | undefined; reason?: string | undefined } | null = null;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string) {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }

  // Test controls
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(message: unknown) {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
  }
  drop() {
    this.readyState = 3;
    this.onerror?.({});
    this.onclose?.({ code: 1006 });
  }
}

let ltpSeq = 0;
export function quote(symbol: string, ltp: number, exchange: 'NSE' | 'BSE' = 'NSE'): Quote {
  ltpSeq += 1;
  return {
    token: 1000 + symbol.length,
    symbol,
    exchange,
    ltp,
    change: ltp - 150000,
    changeBp: Math.round(((ltp - 150000) * 10000) / 150000),
    open: 150000,
    high: Math.max(150000, ltp),
    low: Math.min(150000, ltp),
    prevClose: 150000,
    volume: ltpSeq,
    ts: '2026-09-25T04:00:00.000Z',
  };
}
