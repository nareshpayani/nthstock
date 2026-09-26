import { AUTH_COOKIES } from '@nthstock/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseCookies, serializeCookie, type CookieOptions } from '../../http/cookies.js';
import type { IssuedSession } from './sessionService.js';

/** Path of the refresh and device cookies: only the auth routes ever receive them. */
export const REFRESH_COOKIE_PATH = '/v1/auth';

const base = (secure: boolean): Omit<CookieOptions, 'maxAge' | 'path'> => ({
  httpOnly: true,
  secure,
  sameSite: 'Strict',
});

/** Adds a Set-Cookie header without dropping ones already set on the reply. */
export function appendSetCookie(reply: FastifyReply, cookie: string): void {
  const existing = reply.getHeader('set-cookie');
  const list =
    existing === undefined ? [] : Array.isArray(existing) ? existing : [String(existing)];
  reply.header('set-cookie', [...list, cookie]);
}

export const requestCookies = (request: FastifyRequest) => parseCookies(request.headers.cookie);

const secondsUntil = (from: Date, to: Date) =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));

/** Sets the access cookie (Path=/, also read by apps/realtime) and the refresh cookie. */
export function setSessionCookies(
  reply: FastifyReply,
  issued: IssuedSession,
  { now, secure }: { now: Date; secure: boolean },
): void {
  appendSetCookie(
    reply,
    serializeCookie(AUTH_COOKIES.access, issued.access.token, {
      ...base(secure),
      path: '/',
      maxAge: secondsUntil(now, issued.access.expiresAt),
    }),
  );
  appendSetCookie(
    reply,
    serializeCookie(AUTH_COOKIES.refresh, issued.refreshToken, {
      ...base(secure),
      path: REFRESH_COOKIE_PATH,
      maxAge: secondsUntil(now, issued.session.expiresAt),
    }),
  );
}

/** Deletes both session cookies (logout, a failed refresh). */
export function clearSessionCookies(reply: FastifyReply, { secure }: { secure: boolean }): void {
  appendSetCookie(
    reply,
    serializeCookie(AUTH_COOKIES.access, '', { ...base(secure), path: '/', maxAge: 0 }),
  );
  appendSetCookie(
    reply,
    serializeCookie(AUTH_COOKIES.refresh, '', {
      ...base(secure),
      path: REFRESH_COOKIE_PATH,
      maxAge: 0,
    }),
  );
}

export type PresentedToken = { token: string; via: 'bearer' | 'cookie' };

/** The access token: `Authorization: Bearer` first, then the access cookie. */
export function accessTokenOf(request: FastifyRequest): PresentedToken | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token) return { token, via: 'bearer' };
  }
  const cookie = requestCookies(request)[AUTH_COOKIES.access];
  return cookie ? { token: cookie, via: 'cookie' } : null;
}

/** Sets the trusted-device cookie (PIN login on this browser). */
export function setDeviceCookie(
  reply: FastifyReply,
  { token, expiresAt }: { token: string; expiresAt: Date },
  { now, secure }: { now: Date; secure: boolean },
): void {
  appendSetCookie(
    reply,
    serializeCookie(AUTH_COOKIES.device, token, {
      ...base(secure),
      path: REFRESH_COOKIE_PATH,
      maxAge: secondsUntil(now, expiresAt),
    }),
  );
}
