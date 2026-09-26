import {
  WS_MAX_SUBSCRIPTIONS,
  WS_PROTOCOL_VERSION,
  type Quote,
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
};

/** One client connection as the hub sees it. */
export type Connection = {
  /** A frame from the client: JSON text, or null for a binary frame (not part of the protocol). */
  receive(text: string | null): void;
  /** The socket closed; forget every subscription. */
  closed(): void;
};

export type Hub = {
  open(socket: ClientSocket): Connection;
  /** Quotes from the feed; each goes only to connections subscribed to its symbol. */
  ingest(quotes: readonly Quote[]): void;
  /** Sends every connection's pending quotes now, one frame each. The flush timer calls this. */
  flush(): void;
  readonly registry: SubscriptionRegistry<Connection>;
  connectionCount(): number;
  /** Stops the flush timer. */
  close(): void;
};

/** At most 4 updates per second per symbol (CLAUDE.md §4). */
export const MAX_UPDATES_PER_SECOND = 4;
export const FLUSH_INTERVAL_MS = 1_000 / MAX_UPDATES_PER_SECOND;

export type HubOptions = {
  logger?: Logger;
  timers?: Timers;
};

type Session = {
  socket: ClientSocket;
  /** Latest quote per subscribed key since the last flush (last value wins). */
  pending: Map<SubscriptionKey, Quote>;
};

const symbolOf = (key: SubscriptionKey) => key.slice(key.indexOf(':') + 1);

/**
 * Transport-agnostic core of apps/realtime: protocol handling, subscriptions, fan-out and
 * conflation (T-070, T-072, T-073). `app.ts` connects it to `ws` sockets and the Redis feed.
 */
export function createHub(options: HubOptions = {}): Hub {
  const logger = options.logger ?? silentLogger;
  const timers = options.timers ?? systemTimers;
  const registry = createSubscriptionRegistry<Connection>();
  const sessions = new Map<Connection, Session>();
  /** Sessions with pending quotes, so a flush touches only those. */
  const dirty = new Set<Session>();

  const sendJson = (socket: ClientSocket, message: WsServerMessage) => {
    socket.send(JSON.stringify(message));
  };

  const open = (socket: ClientSocket): Connection => {
    const session: Session = { socket, pending: new Map() };
    const connection: Connection = {
      receive(text) {
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
            }
            return;
        }
      },
      closed() {
        registry.removeConnection(connection);
        sessions.delete(connection);
        dirty.delete(session);
      },
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

  /** One frame per connection per flush, batching every symbol that changed. */
  const flush = () => {
    for (const session of dirty) {
      const quotes = [...session.pending.values()];
      session.pending.clear();
      if (quotes.length === 0) continue;
      try {
        sendJson(session.socket, { v: WS_PROTOCOL_VERSION, type: 'quotes', quotes });
      } catch (error) {
        logger.warn('send failed', { error: String(error) });
      }
    }
    dirty.clear();
  };

  const flushTimer = timers.setInterval(flush, FLUSH_INTERVAL_MS);

  return {
    open,
    ingest,
    flush,
    registry,
    connectionCount: () => sessions.size,
    close: () => timers.clearInterval(flushTimer),
  };
}
