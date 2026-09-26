import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WS_PROTOCOL_VERSION, type WsServerMessage } from '@nthstock/contracts';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { silentLogger, type Logger } from './logger.js';
import { errorMessage, parseClientMessage } from './protocol.js';

/** Path of the WebSocket endpoint; the web app derives `ws(s)://<host>/ws` from the same path. */
export const WS_PATH = '/ws';

export type RealtimeServerOptions = {
  logger?: Logger;
};

export type RealtimeServer = {
  readonly http: Server;
  /** Starts listening; resolves with the bound port (pass 0 in tests for a free one). */
  listen(port: number, host?: string): Promise<number>;
  /** Drops every connection and stops listening. */
  close(): Promise<void>;
  connectionCount(): number;
};

const sendJson = (socket: WebSocket, message: WsServerMessage) => {
  socket.send(JSON.stringify(message));
};

const textOf = (data: RawData, isBinary: boolean): string | null => {
  if (isBinary) return null;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data as ArrayBuffer).toString('utf8');
};

/**
 * The realtime WebSocket server (T-069, ADR 0004 §4) on `ws`: an HTTP server with `GET /health`
 * and a WebSocket endpoint at `/ws`. Built without listening, so tests bind it to a free port.
 */
export function createRealtimeServer(options: RealtimeServerOptions = {}): RealtimeServer {
  const logger = options.logger ?? silentLogger;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  const handleHttp = (request: IncomingMessage, response: ServerResponse) => {
    const path = (request.url ?? '/').split('?')[0];
    if (request.method === 'GET' && path === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', connections: wss.clients.size }));
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
    socket.on('message', (data, isBinary) => {
      const parsed = parseClientMessage(textOf(data, isBinary));
      if (!parsed.ok) {
        sendJson(socket, errorMessage(parsed.code, parsed.message));
        return;
      }
      const message = parsed.message;
      if (message.type === 'ping') {
        sendJson(socket, { v: WS_PROTOCOL_VERSION, type: 'pong', id: message.id });
      }
    });
    socket.on('error', (error) => {
      logger.warn('socket error', { error: error.message });
    });
  });

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
    close: () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close();
        if (!http.listening) {
          resolve();
          return;
        }
        http.close(() => resolve());
      }),
    connectionCount: () => wss.clients.size,
  };
}
