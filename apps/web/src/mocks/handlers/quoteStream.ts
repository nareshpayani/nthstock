import {
  WS_MAX_SUBSCRIPTIONS,
  WS_PROTOCOL_VERSION,
  WsClientMessage,
  type AccountState,
  type Exchange,
  type Notification,
  type Order,
  type PriceAlert,
  type Quote,
  type TrailingStop,
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

/**
 * The private order channel (T-132): order updates from the orders mock, and who is signed in at
 * the socket's host. An update goes to a connection only when its owner is that user, like
 * apps/realtime sends a user's updates to that user's connections only (T-133). Trailing-stop
 * updates and the account snapshot feed `accountDelta` frames (T08).
 */
export type OrderUpdateSource = {
  onOrderUpdate(listener: (userId: string, order: Order) => void): () => void;
  activeUserId(host: string): string | null;
  onTrailingStopUpdate?(listener: (userId: string, stop: TrailingStop) => void): () => void;
  accountState?(userId: string): Promise<AccountState>;
  /** New notifications (NSTOCK-0344): sent to the owner's connections at once, in either mode. */
  onNotification?(
    listener: (userId: string, notification: Notification, alert?: PriceAlert) => void,
  ): () => void;
};

/** The mock market's focus lane (SPEC-TFC-1 TFC-11), when the adapter has one. */
type FocusingMarket = { focus(symbol: string | null): void };
const hasFocus = (adapter: MarketDataAdapter): adapter is MarketDataAdapter & FocusingMarket =>
  typeof (adapter as Partial<FocusingMarket>).focus === 'function';

export type QuoteStreamOptions = {
  /** The WebSocket URL to intercept (the same one the app's WS client connects to). */
  url: string;
  flushMs?: number;
  timers?: IntervalTimers;
  orders?: OrderUpdateSource;
};

const keyOf = (symbol: string, exchange: Exchange) => `${exchange}:${symbol}`;

/**
 * The mock realtime server (T-055), speaking the contracts WS protocol over MSW's `ws` API. Each
 * connection keeps its own subscriptions; adapter ticks are conflated per symbol (latest wins) and
 * flushed as one `quotes` frame every 250 ms. A subscribe gets the current quote on the next flush,
 * so prices show even while the market is closed. Order updates of the signed-in user go out at
 * once as `orderUpdate` messages (see `OrderUpdateSource`).
 *
 * A `focus` message switches the connection to `accountDelta` frames (ADR 0012, T08): each flush
 * then carries the quotes, the focused instrument's depth, and the orders, trailing stops and
 * positions that changed since the last flush, at the engine `seq`, so a tick and the fill it
 * caused reach the client in one frame. `quotes` and `orderUpdate` messages stop.
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
    // accountDelta mode (T08): set by the first `focus` message.
    let deltas = false;
    let focused: { symbol: string; exchange: Exchange } | null = null;
    const pendingOrders = new Map<string, Order>();
    const pendingStops = new Map<string, TrailingStop>();
    let accountChanged = false;
    let seq = 0;
    let flushing = false;

    const send = (message: WsServerMessage) => {
      if (!closed) client.send(JSON.stringify(message));
    };
    const error = (message: WsError) => {
      send(message);
    };

    const { orders } = options;
    const signedIn = () => orders?.activeUserId(client.url.host) ?? null;
    const stopOrders = orders?.onOrderUpdate((userId, order) => {
      if (signedIn() !== userId) return;
      if (deltas) {
        pendingOrders.set(order.id, order);
        accountChanged = true;
      } else {
        send({ v: WS_PROTOCOL_VERSION, type: 'orderUpdate', order });
      }
    });
    const stopStops = orders?.onTrailingStopUpdate?.((userId, stop) => {
      if (!deltas || signedIn() !== userId) return;
      pendingStops.set(stop.id, stop);
      accountChanged = true;
    });

    const stopNotifications = orders?.onNotification?.((userId, notification, alert) => {
      if (signedIn() !== userId) return;
      send({
        v: WS_PROTOCOL_VERSION,
        type: 'notification',
        notification,
        ...(alert ? { alert } : {}),
      });
    });

    /** One `accountDelta` frame of everything since the last one; nothing when nothing changed. */
    const flushDelta = async () => {
      if (pending.size === 0 && pendingOrders.size === 0 && pendingStops.size === 0) return;
      const quotes = [...pending.values()];
      const changedOrders = [...pendingOrders.values()];
      const changedStops = [...pendingStops.values()];
      const changedAccount = accountChanged;
      pending.clear();
      pendingOrders.clear();
      pendingStops.clear();
      accountChanged = false;
      const userId = signedIn();
      const [state, depth] = await Promise.all([
        userId && orders?.accountState ? orders.accountState(userId) : null,
        focused ? adapter.getDepth(focused.symbol, focused.exchange) : null,
      ]);
      // The frame's seq is its newest change (or the last frame's), never the snapshot's: a change
      // the snapshot already holds goes out in the next frame, so a client sees no false gap.
      seq = Math.max(seq, ...changedOrders.map((o) => o.seq ?? 0));
      seq = Math.max(seq, ...changedStops.map((stop) => stop.seq));
      const ticked = new Set(quotes.map((quote) => quote.token));
      send({
        v: WS_PROTOCOL_VERSION,
        type: 'accountDelta',
        seq,
        at: new Date().toISOString(),
        quotes,
        ...(depth ? { depth } : {}),
        orders: changedOrders,
        // A fill moves every position's figures; a tick moves its own instrument's LTP and P&L.
        positions: (state?.positions ?? []).filter(
          (position) => changedAccount || ticked.has(position.token),
        ),
        trailingStops: changedStops,
        ...(changedAccount && state ? { funds: state.funds } : {}),
      });
    };

    const flushTimer = timers.setInterval(() => {
      if (deltas) {
        if (flushing) return;
        flushing = true;
        void flushDelta().finally(() => {
          flushing = false;
        });
        return;
      }
      if (pending.size === 0) return;
      const quotes = [...pending.values()];
      pending.clear();
      send({ v: WS_PROTOCOL_VERSION, type: 'quotes', quotes });
    }, flushMs);

    const focus = async (symbol: string | null, exchange: Exchange) => {
      focused = symbol === null ? null : { symbol, exchange };
      if (hasFocus(adapter)) adapter.focus(symbol);
      if (deltas) return;
      // The first frame starts from the account's seq, so changes before it read as stale.
      const userId = signedIn();
      if (userId && orders?.accountState) seq = (await orders.accountState(userId)).seq;
      deltas = true;
    };

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
      } else if (message.type === 'focus') {
        await focus(message.symbol, message.exchange);
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
      stopOrders?.();
      stopStops?.();
      stopNotifications?.();
      if (focused && hasFocus(adapter)) adapter.focus(null);
      timers.clearInterval(flushTimer);
      for (const stop of subscriptions.values()) stop();
      subscriptions.clear();
      pending.clear();
    });
  });
}
