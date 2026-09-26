import {
  WS_MAX_SUBSCRIPTIONS,
  WS_PROTOCOL_VERSION,
  type Quote,
  type WsServerMessage,
} from '@nthstock/contracts';
import { silentLogger, type Logger } from './logger.js';
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
  readonly registry: SubscriptionRegistry<Connection>;
  connectionCount(): number;
};

export type HubOptions = {
  logger?: Logger;
};

const symbolOf = (key: SubscriptionKey) => key.slice(key.indexOf(':') + 1);

/**
 * Transport-agnostic core of apps/realtime: protocol handling, subscriptions and fan-out
 * (T-070, T-072). `app.ts` connects it to `ws` sockets and the Redis feed.
 */
export function createHub(options: HubOptions = {}): Hub {
  const logger = options.logger ?? silentLogger;
  const registry = createSubscriptionRegistry<Connection>();
  const sockets = new Map<Connection, ClientSocket>();

  const sendJson = (socket: ClientSocket, message: WsServerMessage) => {
    socket.send(JSON.stringify(message));
  };

  const open = (socket: ClientSocket): Connection => {
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
            registry.remove(
              connection,
              message.symbols.map((symbol) => subscriptionKey(symbol, message.exchange)),
            );
            return;
        }
      },
      closed() {
        registry.removeConnection(connection);
        sockets.delete(connection);
      },
    };
    sockets.set(connection, socket);
    return connection;
  };

  const ingest = (quotes: readonly Quote[]) => {
    const outgoing = new Map<Connection, Quote[]>();
    for (const quote of quotes) {
      for (const connection of registry.subscribersOf(
        subscriptionKey(quote.symbol, quote.exchange),
      )) {
        const list = outgoing.get(connection);
        if (list) list.push(quote);
        else outgoing.set(connection, [quote]);
      }
    }
    for (const [connection, list] of outgoing) {
      const socket = sockets.get(connection);
      if (!socket) continue;
      try {
        sendJson(socket, { v: WS_PROTOCOL_VERSION, type: 'quotes', quotes: list });
      } catch (error) {
        logger.warn('send failed', { error: String(error) });
      }
    }
  };

  return { open, ingest, registry, connectionCount: () => sockets.size };
}
