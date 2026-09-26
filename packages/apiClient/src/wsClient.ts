import {
  WS_MAX_SUBSCRIPTIONS,
  WS_PROTOCOL_VERSION,
  WsServerMessage,
  type Exchange,
  type Quote,
  type WsClientMessage,
} from '@nthstock/contracts';

/** The parts of a browser WebSocket the client uses, so tests can pass a fake. */
export type WebSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

export type WebSocketConstructor = new (url: string) => WebSocketLike;

/** Timer functions, injectable for fake-timer tests. */
export type Timers = {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};

type TimerGlobals = Timers;
const g = () => globalThis as unknown as TimerGlobals;

/** Looks timers up on each call, so fake timers installed after construction still apply. */
export const globalTimers: Timers = {
  setTimeout: (callback, ms) => g().setTimeout(callback, ms),
  clearTimeout: (handle) => {
    g().clearTimeout(handle);
  },
  setInterval: (callback, ms) => g().setInterval(callback, ms),
  clearInterval: (handle) => {
    g().clearInterval(handle);
  },
};

export type WsStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export type BackoffOptions = { initialMs: number; maxMs: number };

export const DEFAULT_BACKOFF: BackoffOptions = { initialMs: 500, maxMs: 30_000 };
export const DEFAULT_HEARTBEAT_MS = 20_000;
const OPEN = 1;

/**
 * Reconnect delay with "equal jitter": half the exponential step is fixed, half random, so a crowd
 * of clients dropped together at 9:15 does not reconnect in lockstep.
 */
export function backoffDelay(attempt: number, random: () => number, backoff = DEFAULT_BACKOFF) {
  const cap = Math.min(backoff.maxMs, backoff.initialMs * 2 ** attempt);
  return Math.round(cap / 2 + (random() * cap) / 2);
}

export type WsClientOptions = {
  /** The realtime endpoint; a function is read on every (re)connect. */
  url: string | (() => string);
  /** Defaults to the global WebSocket, looked up on each connect (MSW patches it at start-up). */
  WebSocket?: WebSocketConstructor;
  timers?: Timers;
  random?: () => number;
  backoff?: BackoffOptions;
  /** Ping interval. A ping still unanswered at the next interval counts as a dead socket. */
  heartbeatMs?: number;
};

export type WsClient = {
  /**
   * Ref-counted: the first subscriber of a symbol sends `subscribe`, the last release sends
   * `unsubscribe`. Changes in one task are coalesced into one frame per exchange.
   */
  subscribe(symbol: string, exchange?: Exchange): () => void;
  onQuotes(listener: (quotes: readonly Quote[]) => void): () => void;
  onMessage(listener: (message: WsServerMessage) => void): () => void;
  onStatus(listener: (status: WsStatus) => void): () => void;
  status(): WsStatus;
  /** Number of symbols currently wanted (for diagnostics and tests). */
  subscriptionCount(): number;
  /** Closes the socket for good: no reconnect. */
  close(): void;
};

type Wanted = { symbol: string; exchange: Exchange; count: number };

const keyOf = (symbol: string, exchange: Exchange) => `${exchange}:${symbol}`;

/**
 * Live-quote WebSocket client (T-054). Connects on the first subscription, reconnects with
 * jittered exponential backoff, resends every subscription after a reconnect and keeps the socket
 * honest with a ping/pong heartbeat.
 */
export function createWsClient(options: WsClientOptions): WsClient {
  const timers = options.timers ?? globalTimers;
  const random = options.random ?? Math.random;
  const backoff = options.backoff ?? DEFAULT_BACKOFF;
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

  const wanted = new Map<string, Wanted>();
  /** What the server currently has for this socket. Cleared on every (re)connect. */
  const sent = new Map<string, Wanted>();
  const quoteListeners = new Set<(quotes: readonly Quote[]) => void>();
  const messageListeners = new Set<(message: WsServerMessage) => void>();
  const statusListeners = new Set<(status: WsStatus) => void>();

  let socket: WebSocketLike | null = null;
  let status: WsStatus = 'idle';
  let attempt = 0;
  let reconnectTimer: unknown = null;
  let heartbeatTimer: unknown = null;
  let pingId = 0;
  let awaitingPong: number | null = null;
  let syncQueued = false;
  let disposed = false;

  const setStatus = (next: WsStatus) => {
    if (next === status) return;
    status = next;
    for (const listener of [...statusListeners]) listener(next);
  };

  const send = (message: WsClientMessage) => {
    socket?.send(JSON.stringify(message));
  };

  const sendChanges = (type: 'subscribe' | 'unsubscribe', items: Wanted[]) => {
    const byExchange = new Map<Exchange, string[]>();
    for (const item of items) {
      const list = byExchange.get(item.exchange) ?? [];
      list.push(item.symbol);
      byExchange.set(item.exchange, list);
    }
    for (const [exchange, symbols] of byExchange) {
      for (let i = 0; i < symbols.length; i += WS_MAX_SUBSCRIPTIONS) {
        send({
          v: WS_PROTOCOL_VERSION,
          type,
          symbols: symbols.slice(i, i + WS_MAX_SUBSCRIPTIONS),
          exchange,
        });
      }
    }
  };

  /** Sends the difference between what is wanted and what the server has. */
  const sync = () => {
    syncQueued = false;
    if (!socket || socket.readyState !== OPEN || status !== 'open') return;
    const adds = [...wanted].filter(([key]) => !sent.has(key)).map(([, item]) => item);
    const removes = [...sent].filter(([key]) => !wanted.has(key)).map(([, item]) => item);
    for (const item of removes) sent.delete(keyOf(item.symbol, item.exchange));
    for (const item of adds) sent.set(keyOf(item.symbol, item.exchange), item);
    if (removes.length > 0) sendChanges('unsubscribe', removes);
    if (adds.length > 0) sendChanges('subscribe', adds);
  };

  const queueSync = () => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(sync);
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer !== null) timers.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    awaitingPong = null;
  };

  const handleMessage = (data: unknown) => {
    if (typeof data !== 'string') return; // Binary quote frames arrive with T-074.
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = WsServerMessage.safeParse(json);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === 'pong' && message.id === awaitingPong) awaitingPong = null;
    if (message.type === 'quotes') {
      for (const listener of [...quoteListeners]) listener(message.quotes);
    }
    for (const listener of [...messageListeners]) listener(message);
  };

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer !== null) return;
    setStatus('reconnecting');
    const delay = backoffDelay(attempt, random, backoff);
    attempt += 1;
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const dropSocket = () => {
    const current = socket;
    socket = null;
    sent.clear();
    stopHeartbeat();
    if (current) {
      current.onopen = null;
      current.onmessage = null;
      current.onclose = null;
      current.onerror = null;
    }
    return current;
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    heartbeatTimer = timers.setInterval(() => {
      if (awaitingPong !== null) {
        // The last ping went unanswered: the connection is dead even if the socket looks open.
        dropSocket()?.close(4000, 'heartbeat timeout');
        scheduleReconnect();
        return;
      }
      pingId += 1;
      awaitingPong = pingId;
      send({ v: WS_PROTOCOL_VERSION, type: 'ping', id: pingId });
    }, heartbeatMs);
  };

  function connect() {
    if (disposed || socket) return;
    const Ctor =
      options.WebSocket ?? (globalThis as unknown as { WebSocket: WebSocketConstructor }).WebSocket;
    const url = typeof options.url === 'function' ? options.url() : options.url;
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
    let next: WebSocketLike;
    try {
      next = new Ctor(url);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = next;
    next.onopen = () => {
      attempt = 0;
      sent.clear();
      setStatus('open');
      startHeartbeat();
      sync();
    };
    next.onmessage = (event) => {
      handleMessage(event.data);
    };
    next.onclose = () => {
      dropSocket();
      scheduleReconnect();
    };
    next.onerror = () => undefined; // A close event always follows.
  }

  return {
    subscribe(symbol, exchange = 'NSE') {
      const key = keyOf(symbol, exchange);
      const item = wanted.get(key) ?? { symbol, exchange, count: 0 };
      item.count += 1;
      wanted.set(key, item);
      if (!disposed && !socket && reconnectTimer === null) connect();
      queueSync();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        item.count -= 1;
        if (item.count === 0 && wanted.get(key) === item) {
          wanted.delete(key);
          queueSync();
        }
      };
    },
    onQuotes(listener) {
      quoteListeners.add(listener);
      return () => quoteListeners.delete(listener);
    },
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    status: () => status,
    subscriptionCount: () => wanted.size,
    close() {
      disposed = true;
      if (reconnectTimer !== null) timers.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      dropSocket()?.close(1000, 'client closed');
      setStatus('closed');
    },
  };
}
