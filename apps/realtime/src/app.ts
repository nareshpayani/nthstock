import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { TEST_CONTROL_PATHS, TestClockRequest, WS_CLOSE_CODES } from '@nthstock/contracts';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { WsAuthenticator } from './auth.js';
import type { QuoteFeed } from './feed.js';
import type { OrderFeed } from './orderFeed.js';
import { createHub, type Connection } from './hub.js';
import { silentLogger, type Logger } from './logger.js';
import type { Timers } from './timers.js';
import type { SubscriptionRegistry } from './registry.js';

/** Path of the WebSocket endpoint; the web app derives `ws(s)://<host>/ws` from the same path. */
export const WS_PATH = '/ws';

export type RealtimeServerOptions = {
  /**
   * Checks every WS upgrade (T-083). A connection without a valid access token is accepted and
   * closed at once with 4401, so the browser sees why (a refused upgrade shows only as 1006).
   */
  authenticate: WsAuthenticator;
  logger?: Logger;
  /** Where quotes come from; the server closes it on close. Left out, nothing is fanned out. */
  feed?: QuoteFeed;
  /**
   * Per-user order updates (T-133), delivered on each user's own connections only. The server
   * watches a user while they have a connection here and closes the feed on close.
   */
  orderFeed?: OrderFeed;
  /** Flush and heartbeat timers; tests inject manual ones. */
  timers?: Timers;
  /** Clock for idle detection, epoch ms. */
  now?: () => number;
  /**
   * E2E only (T-162): answers `POST /v1/__test/clock` by calling `setTime` (the clock the
   * authenticator checks token expiry against). Left out, the path is a 404 like any other.
   * `server.ts` passes it only for `NODE_ENV=test` with `ENABLE_TEST_CONTROLS=true`.
   */
  testControls?: { setTime(at: string): void; now(): number };
};

/** Largest test-control body read (a small JSON object). */
const MAX_TEST_BODY_BYTES = 1024;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
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
export function createRealtimeServer(options: RealtimeServerOptions): RealtimeServer {
  const logger = options.logger ?? silentLogger;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const hub = createHub({
    logger,
    ...(options.timers ? { timers: options.timers } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  const detachFeed = options.feed?.onQuotes(hub.ingest);
  const detachOrders = options.orderFeed?.onOrderUpdate(hub.deliverOrder);

  const testControls = options.testControls;
  const handleTestClock = (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_TEST_BODY_BYTES) chunks.push(chunk);
    });
    request.on('end', () => {
      const parsed = TestClockRequest.safeParse(
        size <= MAX_TEST_BODY_BYTES ? parseJson(Buffer.concat(chunks).toString('utf8')) : null,
      );
      if (!parsed.success || !testControls) {
        sendJson(response, 400, { status: 'bad_request' });
        return;
      }
      testControls.setTime(parsed.data.at);
      sendJson(response, 200, { now: new Date(testControls.now()).toISOString() });
    });
  };

  const handleHttp = (request: IncomingMessage, response: ServerResponse) => {
    const path = (request.url ?? '/').split('?')[0];
    if (request.method === 'GET' && path === '/health') {
      sendJson(response, 200, { status: 'ok', ...hub.stats() });
      return;
    }
    if (testControls && request.method === 'POST' && path === TEST_CONTROL_PATHS.clock) {
      handleTestClock(request, response);
      return;
    }
    sendJson(response, 404, { status: 'not_found' });
  };

  const http = createServer(handleHttp);

  http.on('upgrade', (request, socket, head) => {
    const path = (request.url ?? '/').split('?')[0];
    if (path !== WS_PATH) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    void options
      .authenticate(request)
      .catch(() => null)
      .then((claims) => {
        if (socket.destroyed) return;
        wss.handleUpgrade(request, socket, head, (client) => {
          if (!claims) {
            client.close(WS_CLOSE_CODES.unauthorized, 'Unauthorized');
            return;
          }
          accept(client, claims.sub);
        });
      });
  });

  /** A connection of user `userId` (the token's subject): quotes, and that user's orders only. */
  const accept = (socket: WebSocket, userId: string) => {
    const connection = hub.open(socket, { userId });
    const unwatch = options.orderFeed?.watch(userId);
    socket.on('message', (data, isBinary) => {
      connection.receive(textOf(data, isBinary));
    });
    socket.on('pong', () => {
      connection.activity();
    });
    socket.on('close', () => {
      connection.closed();
      unwatch?.();
    });
    socket.on('error', (error) => {
      logger.warn('socket error', { error: error.message });
    });
  };

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
        detachOrders?.();
        hub.close();
        await options.feed?.close();
        await options.orderFeed?.close();
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
