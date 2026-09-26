import { createHash, timingSafeEqual } from 'node:crypto';
import { AUTH_CSRF_HEADER } from '@nthstock/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiHttpError } from './apiError.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_TOKEN_LENGTH = 256;

export const isStateChanging = (method: string) => STATE_CHANGING.has(method.toUpperCase());

/** The CSRF header value, or null when it is missing, repeated, empty or too long. */
export function csrfHeaderOf(request: FastifyRequest): string | null {
  const value = request.headers[AUTH_CSRF_HEADER];
  if (typeof value !== 'string') return null;
  const token = value.trim();
  return token.length > 0 && token.length <= MAX_TOKEN_LENGTH ? token : null;
}

/** Constant-time comparison of two tokens of any length. */
export function sameToken(a: string, b: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Every state-changing `/v1` request must carry the CSRF header (T-082), before anything else
 * runs; 403 FORBIDDEN otherwise. Routes with a session also check the value against the session's
 * token (see `createAuthenticate`); see `AUTH_CSRF_HEADER` for the pre-session rule.
 */
export function installCsrfCheck(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    if (!isStateChanging(request.method) || !request.url.startsWith('/v1/')) return;
    if (!csrfHeaderOf(request)) {
      throw new ApiHttpError(
        403,
        'FORBIDDEN',
        'Missing CSRF token. Reload the page and try again.',
      );
    }
  });
}
