import type { ClientSocket } from '../hub.js';
import type { WsServerMessage } from '@nthstock/contracts';

export type FakeSocket = ClientSocket & {
  readonly sent: (string | Uint8Array)[];
  /** JSON messages sent so far, parsed. */
  json(): WsServerMessage[];
  closedWith: { code: number | undefined; reason: string | undefined } | null;
  pings: number;
  bufferedAmount: number;
};

export function fakeSocket(): FakeSocket {
  const sent: (string | Uint8Array)[] = [];
  const socket: FakeSocket = {
    sent,
    closedWith: null,
    pings: 0,
    bufferedAmount: 0,
    ping() {
      socket.pings += 1;
    },
    send(data) {
      sent.push(data);
    },
    close(code, reason) {
      socket.closedWith = { code, reason };
    },
    json: () =>
      sent
        .filter((data): data is string => typeof data === 'string')
        .map((data) => JSON.parse(data) as WsServerMessage),
  };
  return socket;
}
