import { ACCESS_TOKEN_TTL_SEC, WS_CLOSE_CODES } from '@nthstock/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createRealtimeServer, WS_PATH, type RealtimeServer } from '../app.js';
import {
  createMemorySessionRevocationFeed,
  type MemorySessionRevocationFeed,
} from './sessionRevocationFeed.js';
import { connectAuthed, testAuthenticator } from '../test/auth.js';

// Closing a revoked session's sockets (T-195), on the in-memory feed. The Redis path is in
// sessionRevocation.integration.test.ts.

const REVOKED = { code: WS_CLOSE_CODES.unauthorized, reason: 'Session revoked' };

let server: RealtimeServer;
let revocations: MemorySessionRevocationFeed;

async function start() {
  revocations = createMemorySessionRevocationFeed();
  server = createRealtimeServer({ authenticate: testAuthenticator(), revocations });
  const port = await server.listen(0, '127.0.0.1');
  return `ws://127.0.0.1:${String(port)}${WS_PATH}`;
}

afterEach(async () => {
  await server.close();
});

describe('session revocation over WebSocket (T-195)', () => {
  it("closes the revoked session's sockets with 4401 and keeps the user's other session", async () => {
    const url = await start();
    const laptop1 = await connectAuthed(url, 'usr_a', 'ses_laptop');
    const laptop2 = await connectAuthed(url, 'usr_a', 'ses_laptop');
    const phone = await connectAuthed(url, 'usr_a', 'ses_phone');
    expect(server.connectionCount()).toBe(3);

    revocations.revoke('ses_laptop', 'usr_a');

    expect(await laptop1.closed).toEqual(REVOKED);
    expect(await laptop2.closed).toEqual(REVOKED);
    expect(await phone.drain()).toEqual([]);
    expect(server.connectionCount()).toBe(1);
    phone.close();
  });

  it('refuses an upgrade for a revoked session with 4401', async () => {
    const url = await start();
    revocations.revoke('ses_gone', 'usr_a');

    const late = await connectAuthed(url, 'usr_a', 'ses_gone');
    expect(await late.closed).toEqual(REVOKED);
    expect(server.connectionCount()).toBe(0);

    const other = await connectAuthed(url, 'usr_a', 'ses_other');
    expect(await other.drain()).toEqual([]);
    other.close();
  });

  it('stops listening for revocations once closed', async () => {
    await start();
    await server.close();
    expect(() => revocations.revoke('ses_a', 'usr_a')).not.toThrow();
  });
});

describe('in-memory session revocation feed', () => {
  it('forgets a revocation once no access token of the session can still be live', async () => {
    let now = 0;
    const feed = createMemorySessionRevocationFeed(() => now);
    feed.revoke('ses_a', 'usr_a');
    now = ACCESS_TOKEN_TTL_SEC * 1000 - 1;
    feed.revoke('ses_b', 'usr_a');
    expect(feed.revokedHere('ses_a')).toBe(true);
    expect(await feed.isRevoked('ses_a')).toBe(true);

    now = ACCESS_TOKEN_TTL_SEC * 1000;
    expect(feed.revokedHere('ses_a')).toBe(false);
    feed.revoke('ses_c', 'usr_a');
    expect(feed.revokedHere('ses_b')).toBe(true);
    expect(await feed.isRevoked('ses_unknown')).toBe(false);
    await feed.close();
    expect(feed.revokedHere('ses_b')).toBe(false);
  });
});
