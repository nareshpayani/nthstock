import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  AUTH_COOKIES,
  AccessTokenClaims,
} from '@nthstock/contracts';
import { jwtVerify } from 'jose';

/** Who opened a connection; null refuses it (close code 4401). */
export type WsAuthenticator = (request: IncomingMessage) => Promise<AccessTokenClaims | null>;

/** Shortest JWT_SECRET accepted: 32 bytes, as in apps/api. */
export const MIN_JWT_SECRET_LENGTH = 32;

/**
 * The access-token key, resolved exactly as apps/api does (`resolveJwtSecret` there): required in
 * production; elsewhere a blank value gets an ephemeral key, which only works when apps/api has the
 * same one, so `npm run dev:api` passes one generated key to both.
 */
export function resolveJwtSecret({
  value,
  production,
  onEphemeral,
}: {
  value: string | undefined;
  production: boolean;
  onEphemeral?: () => void;
}): Uint8Array {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') {
    if (production) throw new Error('JWT_SECRET must be set in production');
    onEphemeral?.();
    return new Uint8Array(randomBytes(MIN_JWT_SECRET_LENGTH));
  }
  if (trimmed.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${String(MIN_JWT_SECRET_LENGTH)} characters`);
  }
  return new TextEncoder().encode(trimmed);
}

/** The value of cookie `name` in a Cookie header, or null. */
export function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      return value === '' ? null : value;
    }
  }
  return null;
}

/**
 * Authenticates the WS upgrade (T-083) with the access JWT apps/api sets in the `nth_at` cookie:
 * HS256 signature, issuer, audience and expiry against the injected clock.
 */
export function createJwtCookieAuthenticator({
  secret,
  now = Date.now,
}: {
  secret: Uint8Array;
  /** Epoch ms; tests inject it. */
  now?: () => number;
}): WsAuthenticator {
  return async (request) => {
    const token = cookieValue(request.headers.cookie, AUTH_COOKIES.access);
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, secret, {
        algorithms: ['HS256'],
        issuer: ACCESS_TOKEN_ISSUER,
        audience: ACCESS_TOKEN_AUDIENCE,
        currentDate: new Date(now()),
        clockTolerance: 0,
      });
      const claims = AccessTokenClaims.safeParse(payload);
      return claims.success ? claims.data : null;
    } catch {
      return null;
    }
  };
}
