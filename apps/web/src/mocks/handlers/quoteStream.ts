import {
  WS_MAX_SUBSCRIPTIONS,
  WS_PROTOCOL_VERSION,
  WsClientMessage,
  type Exchange,
  type Quote,
  type WsError,
  type WsServerMessage,
} from '@nthstock/contracts';
import type { MarketDataAdapter, Unsubscribe } from '@nthstock/marketData';
import { ws } from 'msw';

/** At most 4 updates/sec/symbol (CLAUDE.md §4): one flush every 250 ms. */
export const QUOTE_FLUSH_MS = 250;

export type IntervalTimers = {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};

type TimerGlobals = IntervalTimers;
const intervalTimers: IntervalTimers = {
  setInterval: (callback, ms) => (globalThis as unknown as TimerGlobals).setInterval(callback, ms),
  clearInterval: (handle) => {
    (globalThis as unknown as TimerGlobals).clearInterval(handle);
  },
};

export type QuoteStreamOptions = {
  /** The WebSocket URL to intercept (the same one the app's WS client connects to). */
  url: string;
  flushMs?: number;
  timers?: IntervalTimers;
};

const keyOf = (symbol: string, exchange: Exchange) => `${exchange}:${symbol}`;

/**
 * The mock realtime server (T-055), speaking the contracts WS protocol over MSW's `ws` API. Each
 * connection keeps its own subscriptions; adapter ticks are conflated per symbol (latest wins) and
 * flushed as one `quotes` frame every 250 ms. A subscribe gets the current quote on the next flush,
 * so prices show even while the market is closed.
 */
export function quoteStreamHandler(adapter: MarketDataAdapter, options: QuoteStreamOptions) {
  const flushMs = options.flushMs ?? QUOTE_FLUSH_MS;
  const timers = options.timers ?? intervalTimers;
  const link = ws.link(options.url);

  return link.addEventListener('connection', ({ client }) => {
    const subscriptions = new Map<string, Unsubscribe>();
    const pending = new Map<string, Quote>();
    let queue = Promise.resolve();
    let closed = false;

    const send = (message: WsServerMessage) => {
      if (!closed) client.send(JSON.stringify(message));
    };
    const error = (message: WsError) => {
      send(message);
    };

    const flushTimer = timers.setInterval(() => {
      if (pending.size === 0) return;
      const quotes = [...pending.values()];
      pending.clear();
      send({ v: WS_PROTOCOL_VERSION, type: 'quotes', quotes });
    }, flushMs);

    const subscribe = async (symbols: readonly string[], exchange: Exchange) => {
      const unknown: string[] = [];
      const refused: string[] = [];
      for (const symbol of symbols) {
        const key = keyOf(symbol, exchange);
        if (subscriptions.has(key)) continue;
        if (subscriptions.size >= WS_MAX_SUBSCRIPTIONS) {
          refused.push(symbol);
          continue;
        }
        const current = await adapter.getQuote(symbol, exchange);
        if (!current || closed) {
          if (!current) unknown.push(symbol);
          continue;
        }
        pending.set(key, current);
        subscriptions.set(
          key,
          adapter.subscribe(
            [symbol],
            (quotes) => {
              for (const quote of quotes) pending.set(key, quote);
            },
            exchange,
          ),
        );
      }
      if (unknown.length > 0) {
        error({
          v: WS_PROTOCOL_VERSION,
          type: 'error',
          code: 'UNKNOWN_SYMBOL',
          message: `Unknown symbol on ${exchange}`,
          symbols: unknown,
        });
      }
      if (refused.length > 0) {
        error({
          v: WS_PROTOCOL_VERSION,
          type: 'error',
          code: 'SUBSCRIPTION_LIMIT',
          message: `At most ${String(WS_MAX_SUBSCRIPTIONS)} symbols per connection`,
          symbols: refused,
        });
      }
    };

    const unsubscribe = (symbols: readonly string[], exchange: Exchange) => {
      for (const symbol of symbols) {
        const key = keyOf(symbol, exchange);
        subscriptions.get(key)?.();
        subscriptions.delete(key);
        pending.delete(key);
      }
    };

    const handle = async (data: unknown) => {
      let json: unknown;
      try {
        json = typeof data === 'string' ? JSON.parse(data) : undefined;
      } catch {
        json = undefined;
      }
      const parsed = WsClientMessage.safeParse(json);
      if (!parsed.success) {
        const wrongVersion =
          typeof json === 'object' &&
          json !== null &&
          'v' in json &&
          json.v !== WS_PROTOCOL_VERSION;
        error({
          v: WS_PROTOCOL_VERSION,
          type: 'error',
          code: wrongVersion ? 'UNSUPPORTED_VERSION' : 'INVALID_MESSAGE',
          message: wrongVersion ? 'Unsupported protocol version' : 'Invalid message',
        });
        return;
      }
      const message = parsed.data;
      if (message.type === 'ping') {
        send({ v: WS_PROTOCOL_VERSION, type: 'pong', id: message.id });
      } else if (message.type === 'subscribe') {
        await subscribe(message.symbols, message.exchange);
      } else {
        unsubscribe(message.symbols, message.exchange);
      }
    };

    client.addEventListener('message', (event) => {
      // One message at a time, so an unsubscribe never overtakes the subscribe before it.
      queue = queue.then(() => handle(event.data));
    });

    client.addEventListener('close', () => {
      closed = true;
      timers.clearInterval(flushTimer);
      for (const stop of subscriptions.values()) stop();
      subscriptions.clear();
      pending.clear();
    });
  });
}
