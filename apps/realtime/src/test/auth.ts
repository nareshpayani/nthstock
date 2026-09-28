import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  ACCESS_TOKEN_TTL_SEC,
  AUTH_COOKIES,
} from '@nthstock/contracts';
import { SignJWT } from 'jose';
import { createJwtCookieAuthenticator } from '../auth.js';
import { connectTestClient, type TestClient } from './wsTestClient.js';

/** A key for tests only; apps/api signs with JWT_SECRET. */
export const TEST_SECRET = new TextEncoder().encode('realtime-tests-only-key-0123456789');
/** The instant test tokens are issued at, epoch ms. */
export const TEST_NOW = Date.parse('2026-09-25T04:00:00.000Z');

export type TokenOptions = {
  secret?: Uint8Array;
  /** Issued-at, epoch ms; default `TEST_NOW`. */
  issuedAt?: number;
  issuer?: string;
  /** The user id (`sub`); default `usr_test`. */
  subject?: string;
  /** The session id (`sid`); default `ses_test`. */
  sessionId?: string;
};

/** An access token like apps/api's (`signAccessToken`). */
export async function signTestToken({
  secret = TEST_SECRET,
  issuedAt = TEST_NOW,
  issuer = ACCESS_TOKEN_ISSUER,
  subject = 'usr_test',
  sessionId = 'ses_test',
}: TokenOptions = {}): Promise<string> {
  const iat = Math.floor(issuedAt / 1000);
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(subject)
    .setIssuer(issuer)
    .setAudience(ACCESS_TOKEN_AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ACCESS_TOKEN_TTL_SEC)
    .sign(secret);
}

export const accessCookie = (token: string) => `${AUTH_COOKIES.access}=${token}`;

/** The authenticator the tests' servers use, with a clock stuck at `now` (default `TEST_NOW`). */
export const testAuthenticator = (now: () => number = () => TEST_NOW) =>
  createJwtCookieAuthenticator({ secret: TEST_SECRET, now });

/**
 * Connects with a valid access-token cookie, as `subject` (default `usr_test`) in session
 * `sessionId` (default `ses_test`).
 */
export async function connectAuthed(
  url: string,
  subject?: string,
  sessionId?: string,
): Promise<TestClient> {
  const token = await signTestToken({
    ...(subject === undefined ? {} : { subject }),
    ...(sessionId === undefined ? {} : { sessionId }),
  });
  return connectTestClient(url, { cookie: accessCookie(token) });
}
