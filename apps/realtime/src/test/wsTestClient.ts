import { WS_PROTOCOL_VERSION, type WsServerMessage } from '@nthstock/contracts';
import { WebSocket } from 'ws';

export type Received =
  { kind: 'json'; message: WsServerMessage } | { kind: 'binary'; data: Uint8Array };

export type TestClient = {
  readonly socket: WebSocket;
  send(message: unknown): void;
  /** The next frame, from the backlog or the wire. */
  next(): Promise<Received>;
  /**
   * Sends a ping and resolves with every frame received before its pong. Frames on one socket are
   * ordered, so this is a deterministic "everything sent so far" barrier without timers.
   */
  drain(): Promise<Received[]>;
  closed: Promise<{ code: number; reason: string }>;
  close(): void;
};

let pingIds = 1_000_000;

/** A `ws` client that queues frames so tests can await them one by one. */
export async function connectTestClient(url: string): Promise<TestClient> {
  const socket = new WebSocket(url);
  const backlog: Received[] = [];
  const waiters: ((frame: Received) => void)[] = [];
  socket.on('message', (data, isBinary) => {
    const bytes = Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data);
    const frame: Received = isBinary
      ? { kind: 'binary', data: new Uint8Array(bytes) }
      : { kind: 'json', message: JSON.parse(bytes.toString('utf8')) as WsServerMessage };
    const waiter = waiters.shift();
    if (waiter) waiter(frame);
    else backlog.push(frame);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.on('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') }));
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  const next = () =>
    new Promise<Received>((resolve) => {
      const frame = backlog.shift();
      if (frame) resolve(frame);
      else waiters.push(resolve);
    });
  const send = (message: unknown) => socket.send(JSON.stringify(message));
  return {
    socket,
    send,
    next,
    async drain() {
      pingIds += 1;
      const id = pingIds;
      send({ v: WS_PROTOCOL_VERSION, type: 'ping', id });
      const frames: Received[] = [];
      for (;;) {
        const frame = await next();
        if (frame.kind === 'json' && frame.message.type === 'pong' && frame.message.id === id) {
          return frames;
        }
        frames.push(frame);
      }
    },
    closed,
    close: () => socket.close(),
  };
}
