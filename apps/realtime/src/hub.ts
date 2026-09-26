import {
  WS_CLOSE_CODES,
  WS_IDLE_TIMEOUT_MS,
  WS_MAX_SUBSCRIPTIONS,
  WS_PROTOCOL_VERSION,
  encodeQuoteFrame,
  instrumentOf,
  type Quote,
  type WsInstrument,
  type WsServerMessage,
} from '@nthstock/contracts';
import { silentLogger, type Logger } from './logger.js';
import { systemTimers, type Timers } from './timers.js';
import { errorMessage, parseClientMessage } from './protocol.js';
import {
  createSubscriptionRegistry,
  subscriptionKey,
  type SubscriptionKey,
  type SubscriptionRegistry,
} from './registry.js';

/** The parts of a `ws` WebSocket the hub uses, so unit tests can pass a fake. */
export type ClientSocket = {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  /** WebSocket protocol-level ping; browsers answer with a pong automatically. */
  ping(): void;
  /** Bytes queued but not yet written to the network. */
  readonly bufferedAmount: number;
};

/** One client connection as the hub sees it. */
export type Connection = {
  /** A frame from the client: JSON text, or null for a binary frame (not part of the protocol). */
  receive(text: string | null): void;
  /** A protocol-level pong (or anything else) arrived: the client is alive. */
  activity(): void;
  /** The socket closed; forget every subscription. Safe to call more than once. */
  closed(): void;
};

export type Hub = {
  open(socket: ClientSocket): Connection;
  /** Quotes from the feed; each goes only to connections subscribed to its symbol. */
  ingest(quotes: readonly Quote[]): void;
  /** Sends every connection's pending quotes now, one frame each. The flush timer calls this. */
  flush(): void;
  /** Pings live connections and closes idle ones. The heartbeat timer calls this. */
  heartbeat(): void;
  readonly registry: SubscriptionRegistry<Connection>;
  connectionCount(): number;
  stats(): HubStats;
  /** Stops the timers. */
  close(): void;
};

export type HubStats = {
  connections: number;
  /** Quote frames not sent because the client was too far behind. */
  droppedFrames: number;
  /** Connections closed for being idle. */
  idleClosed: number;
};

/** At most 4 updates per second per symbol (CLAUDE.md §4). */
export const MAX_UPDATES_PER_SECOND = 4;
export const FLUSH_INTERVAL_MS = 1_000 / MAX_UPDATES_PER_SECOND;

/** How often the heartbeat runs: idle checks each time, a ping every `PING_INTERVAL_MS`. */
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const PING_INTERVAL_MS = 20_000;
/** Above this many bytes buffered for a client, its quote frames are dropped (T-075). */
export const MAX_BUFFERED_BYTES = 1024 * 1024;

export type HubOptions = {
  logger?: Logger;
  timers?: Timers;
  /** Milliseconds since the epoch; injected so idle tests never read the wall clock. */
  now?: () => number;
  idleTimeoutMs?: number;
  maxBufferedBytes?: number;
};

type Session = {
  socket: ClientSocket;
  /** Latest quote per subscribed key since the last flush (last value wins). */
  pending: Map<SubscriptionKey, Quote>;
  /** What this client was last told about each subscribed key's instrument (T-074). */
  instruments: Map<SubscriptionKey, string>;
  /** When the client last sent anything (a message or a pong). */
  lastSeen: number;
  lastPing: number;
  /** True while frames are being dropped, so the slowdown is logged once. */
  lagging: boolean;
  connection: Connection;
};

const instrumentSignature = (i: WsInstrument) =>
  `${i.token}|${i.open}|${i.prevClose}|${i.symbol}|${i.exchange}`;

const symbolOf = (key: SubscriptionKey) => key.slice(key.indexOf(':') + 1);

/**
 * Transport-agnostic core of apps/realtime: protocol handling, subscriptions, fan-out,
 * conflation, heartbeat and slow-consumer handling (T-070, T-072, T-073, T-075). `app.ts` connects it to `ws` sockets and the Redis feed.
 */
export function createHub(options: HubOptions = {}): Hub {
  const logger = options.logger ?? silentLogger;
  const timers = options.timers ?? systemTimers;
  const now = options.now ?? Date.now;
  const idleTimeoutMs = options.idleTimeoutMs ?? WS_IDLE_TIMEOUT_MS;
  const maxBufferedBytes = options.maxBufferedBytes ?? MAX_BUFFERED_BYTES;
  const stats = { droppedFrames: 0, idleClosed: 0 };
  const registry = createSubscriptionRegistry<Connection>();
  const sessions = new Map<Connection, Session>();
  /** Sessions with pending quotes, so a flush touches only those. */
  const dirty = new Set<Session>();

  const sendJson = (socket: ClientSocket, message: WsServerMessage) => {
    socket.send(JSON.stringify(message));
  };

  const open = (socket: ClientSocket): Connection => {
    const openedAt = now();
    const connection: Connection = {
      receive(text) {
        session.lastSeen = now();
        const parsed = parseClientMessage(text);
        if (!parsed.ok) {
          sendJson(socket, errorMessage(parsed.code, parsed.message));
          return;
        }
        const message = parsed.message;
        switch (message.type) {
          case 'ping':
            sendJson(socket, { v: WS_PROTOCOL_VERSION, type: 'pong', id: message.id });
            return;
          case 'subscribe': {
            const keys = message.symbols.map((symbol) => subscriptionKey(symbol, message.exchange));
            const { rejected } = registry.add(connection, keys);
            if (rejected.length > 0) {
              sendJson(
                socket,
                errorMessage(
                  'SUBSCRIPTION_LIMIT',
                  `A connection may subscribe to at most ${WS_MAX_SUBSCRIPTIONS} symbols`,
                  rejected.map(symbolOf),
                ),
              );
            }
            return;
          }
          case 'unsubscribe':
            for (const key of registry.remove(
              connection,
              message.symbols.map((symbol) => subscriptionKey(symbol, message.exchange)),
            )) {
              session.pending.delete(key);
              session.instruments.delete(key);
            }
            return;
        }
      },
      activity() {
        session.lastSeen = now();
      },
      closed() {
        registry.removeConnection(connection);
        sessions.delete(connection);
        dirty.delete(session);
      },
    };
    const session: Session = {
      socket,
      pending: new Map(),
      instruments: new Map(),
      lastSeen: openedAt,
      lastPing: openedAt,
      lagging: false,
      connection,
    };
    sessions.set(connection, session);
    return connection;
  };

  /** Conflation (T-073): only the latest quote per symbol waits for the next flush. */
  const ingest = (quotes: readonly Quote[]) => {
    for (const quote of quotes) {
      const key = subscriptionKey(quote.symbol, quote.exchange);
      for (const connection of registry.subscribersOf(key)) {
        const session = sessions.get(connection);
        if (!session) continue;
        session.pending.set(key, quote);
        dirty.add(session);
      }
    }
  };

  /**
   * Sends a session's quotes as one binary frame (T-074), preceded by an `instruments` message for
   * any instrument the client has not been told about or that changed (open or previous close
   * roll over at the session start). If a value does not fit the binary record, the batch goes
   * as a JSON `quotes` message instead.
   */
  const sendQuotes = (session: Session, entries: [SubscriptionKey, Quote][]) => {
    // Slow consumer: a client this far behind would only fall further behind. Drop the frame (its
    // symbols come again on their next tick) instead of buffering without bound.
    if (session.socket.bufferedAmount > maxBufferedBytes) {
      stats.droppedFrames += 1;
      if (!session.lagging) {
        session.lagging = true;
        logger.warn('slow consumer: dropping quote frames', {
          bufferedAmount: session.socket.bufferedAmount,
        });
      }
      return;
    }
    session.lagging = false;
    const quotes = entries.map(([, quote]) => quote);
    let frame: Uint8Array;
    try {
      frame = encodeQuoteFrame(quotes);
    } catch (error) {
      logger.warn('quote frame fallback to JSON', { error: String(error) });
      sendJson(session.socket, { v: WS_PROTOCOL_VERSION, type: 'quotes', quotes });
      return;
    }
    const fresh: WsInstrument[] = [];
    for (const [key, quote] of entries) {
      const instrument = instrumentOf(quote);
      const signature = instrumentSignature(instrument);
      if (session.instruments.get(key) === signature) continue;
      session.instruments.set(key, signature);
      fresh.push(instrument);
    }
    if (fresh.length > 0) {
      sendJson(session.socket, { v: WS_PROTOCOL_VERSION, type: 'instruments', instruments: fresh });
    }
    session.socket.send(frame);
  };

  /** One frame per connection per flush, batching every symbol that changed. */
  const flush = () => {
    for (const session of dirty) {
      const entries = [...session.pending];
      session.pending.clear();
      if (entries.length === 0) continue;
      try {
        sendQuotes(session, entries);
      } catch (error) {
        logger.warn('send failed', { error: String(error) });
      }
    }
    dirty.clear();
  };

  const heartbeat = () => {
    const at = now();
    for (const session of [...sessions.values()]) {
      if (at - session.lastSeen >= idleTimeoutMs) {
        stats.idleClosed += 1;
        session.connection.closed();
        try {
          session.socket.close(WS_CLOSE_CODES.idleTimeout, 'idle timeout');
        } catch (error) {
          logger.warn('close failed', { error: String(error) });
        }
        continue;
      }
      if (at - session.lastPing >= PING_INTERVAL_MS) {
        session.lastPing = at;
        try {
          session.socket.ping();
        } catch (error) {
          logger.warn('ping failed', { error: String(error) });
        }
      }
    }
  };

  const flushTimer = timers.setInterval(flush, FLUSH_INTERVAL_MS);
  const heartbeatTimer = timers.setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);

  return {
    open,
    ingest,
    flush,
    heartbeat,
    registry,
    connectionCount: () => sessions.size,
    stats: () => ({ connections: sessions.size, ...stats }),
    close() {
      timers.clearInterval(flushTimer);
      timers.clearInterval(heartbeatTimer);
    },
  };
}
