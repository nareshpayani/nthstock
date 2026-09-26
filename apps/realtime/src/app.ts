import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { QuoteFeed } from './feed.js';
import { createHub, type Connection } from './hub.js';
import { silentLogger, type Logger } from './logger.js';
import type { Timers } from './timers.js';
import type { SubscriptionRegistry } from './registry.js';

/** Path of the WebSocket endpoint; the web app derives `ws(s)://<host>/ws` from the same path. */
export const WS_PATH = '/ws';

export type RealtimeServerOptions = {
  logger?: Logger;
  /** Where quotes come from; the server closes it on close. Left out, nothing is fanned out. */
  feed?: QuoteFeed;
  /** Flush and heartbeat timers; tests inject manual ones. */
  timers?: Timers;
  /** Clock for idle detection, epoch ms. */
  now?: () => number;
};

export type RealtimeServer = {
  readonly http: Server;
  /** Starts listening; resolves with the bound port (pass 0 in tests for a free one). */
  listen(port: number, host?: string): Promise<number>;
  /** Drops every connection, closes the feed and stops listening. */
  close(): Promise<void>;
  connectionCount(): number;
  /** Sends pending conflated quotes now instead of at the next timer flush (tests). */
  flush(): void;
  /** Runs the heartbeat now: pings, and closes idle connections (tests). */
  heartbeat(): void;
  /** Who is subscribed to what; read-only use outside the hub. */
  readonly registry: SubscriptionRegistry<Connection>;
};

const textOf = (data: RawData, isBinary: boolean): string | null => {
  if (isBinary) return null;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data as ArrayBuffer).toString('utf8');
};

/**
 * The realtime WebSocket server (T-069, ADR 0004 §4) on `ws`: an HTTP server with `GET /health`
 * and a WebSocket endpoint at `/ws`, fanning feed quotes out through the hub. Built without
 * listening, so tests bind it to a free port.
 */
export function createRealtimeServer(options: RealtimeServerOptions = {}): RealtimeServer {
  const logger = options.logger ?? silentLogger;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const hub = createHub({
    logger,
    ...(options.timers ? { timers: options.timers } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const detachFeed = options.feed?.onQuotes(hub.ingest);

  const handleHttp = (request: IncomingMessage, response: ServerResponse) => {
    const path = (request.url ?? '/').split('?')[0];
    if (request.method === 'GET' && path === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', ...hub.stats() }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'not_found' }));
  };

  const http = createServer(handleHttp);

  http.on('upgrade', (request, socket, head) => {
    const path = (request.url ?? '/').split('?')[0];
    if (path !== WS_PATH) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit('connection', client, request);
    });
  });

  wss.on('connection', (socket: WebSocket) => {
    const connection = hub.open(socket);
    socket.on('message', (data, isBinary) => {
      connection.receive(textOf(data, isBinary));
    });
    socket.on('pong', () => {
      connection.activity();
    });
    socket.on('close', () => {
      connection.closed();
    });
    socket.on('error', (error) => {
      logger.warn('socket error', { error: error.message });
    });
  });

  let closing: Promise<void> | null = null;

  return {
    http,
    listen: (port, host) =>
      new Promise((resolve, reject) => {
        http.once('error', reject);
        http.listen(port, host, () => {
          http.off('error', reject);
          resolve((http.address() as AddressInfo).port);
        });
      }),
    close() {
      closing ??= (async () => {
        detachFeed?.();
        hub.close();
        await options.feed?.close();
        for (const client of wss.clients) client.terminate();
        wss.close();
        if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
      })();
      return closing;
    },
    connectionCount: () => hub.connectionCount(),
    flush: hub.flush,
    heartbeat: hub.heartbeat,
    registry: hub.registry,
  };
}
