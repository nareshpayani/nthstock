import { ACCESS_TOKEN_TTL_SEC, WS_CLOSE_CODES, WS_PROTOCOL_VERSION } from '@nthstock/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRealtimeServer, WS_PATH, type RealtimeServer } from './app.js';
import {
  MIN_JWT_SECRET_LENGTH,
  cookieValue,
  resolveJwtSecret,
  type WsAuthenticator,
} from './auth.js';
import {
  TEST_NOW,
  accessCookie,
  connectAuthed,
  signTestToken,
  testAuthenticator,
} from './test/auth.js';
import { connectTestClient } from './test/wsTestClient.js';

let server: RealtimeServer;

async function start(authenticate: WsAuthenticator = testAuthenticator()) {
  server = createRealtimeServer({ authenticate });
  const port = await server.listen(0, '127.0.0.1');
  return `ws://127.0.0.1:${String(port)}${WS_PATH}`;
}

afterEach(async () => {
  await server.close();
});

/** Connects with `cookie` and resolves with the close the server sends. */
async function closeFor(url: string, cookie?: string) {
  const client = await connectTestClient(url, cookie === undefined ? {} : { cookie });
  return client.closed;
}

const UNAUTHORIZED = { code: WS_CLOSE_CODES.unauthorized, reason: 'Unauthorized' };

describe('WS upgrade authentication', () => {
  it('accepts a connection with a valid access-token cookie', async () => {
    const url = await start();
    const client = await connectAuthed(url);

    client.send({ v: WS_PROTOCOL_VERSION, type: 'ping', id: 1 });
    expect(await client.next()).toMatchObject({ message: { type: 'pong', id: 1 } });
    expect(server.connectionCount()).toBe(1);
    client.close();
  });

  it('closes with 4401 when the token is missing', async () => {
    const url = await start();

    expect(await closeFor(url)).toEqual(UNAUTHORIZED);
    expect(await closeFor(url, 'other=1')).toEqual(UNAUTHORIZED);
    expect(await closeFor(url, accessCookie(''))).toEqual(UNAUTHORIZED);
    expect(server.connectionCount()).toBe(0);
  });

  it('closes with 4401 when the token has expired', async () => {
    let now = TEST_NOW + ACCESS_TOKEN_TTL_SEC * 1000 - 1000;
    const url = await start(testAuthenticator(() => now));
    const token = await signTestToken();

    const live = await connectTestClient(url, { cookie: accessCookie(token) });
    expect(server.connectionCount()).toBe(1);
    live.close();

    now = TEST_NOW + ACCESS_TOKEN_TTL_SEC * 1000;
    expect(await closeFor(url, accessCookie(token))).toEqual(UNAUTHORIZED);
  });

  it('closes with 4401 for a forged, foreign or malformed token', async () => {
    const url = await start();
    const otherKey = new TextEncoder().encode('another-key-that-is-long-enough-0123');

    for (const token of [
      await signTestToken({ secret: otherKey }),
      await signTestToken({ issuer: 'someone-else' }),
      'not.a.jwt',
    ]) {
      expect(await closeFor(url, accessCookie(token))).toEqual(UNAUTHORIZED);
    }
  });

  it('fails closed when the authenticator throws', async () => {
    const url = await start(() => Promise.reject(new Error('boom')));
    expect(await closeFor(url, accessCookie(await signTestToken()))).toEqual(UNAUTHORIZED);
  });
});

describe('cookieValue', () => {
  it('finds a cookie among others and ignores blanks', () => {
    expect(cookieValue('a=1; nth_at=tok.en; b=2', 'nth_at')).toBe('tok.en');
    expect(cookieValue('nth_at=', 'nth_at')).toBeNull();
    expect(cookieValue('xnth_at=1; junk', 'nth_at')).toBeNull();
    expect(cookieValue(undefined, 'nth_at')).toBeNull();
  });
});

describe('resolveJwtSecret', () => {
  it('uses the configured secret and rejects a short one', () => {
    const value = 'k'.repeat(MIN_JWT_SECRET_LENGTH);
    expect(resolveJwtSecret({ value, production: true })).toEqual(new TextEncoder().encode(value));
    expect(() => resolveJwtSecret({ value: 'short', production: false })).toThrow(/at least 32/);
  });

  it('fails fast in production and makes an ephemeral key elsewhere', () => {
    const onEphemeral = vi.fn();
    expect(() => resolveJwtSecret({ value: ' ', production: true })).toThrow(/production/);
    expect(resolveJwtSecret({ value: undefined, production: false, onEphemeral })).toHaveLength(
      MIN_JWT_SECRET_LENGTH,
    );
    expect(onEphemeral).toHaveBeenCalledOnce();
  });
});
