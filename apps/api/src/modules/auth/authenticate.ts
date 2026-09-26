import type { FastifyRequest } from 'fastify';
import { ApiHttpError } from '../../http/apiError.js';
import { csrfHeaderOf, isStateChanging, sameToken } from '../../http/csrf.js';
import type { Authenticate } from '../../http/registerRoute.js';
import { accessTokenOf } from './sessionCookies.js';
import type { AuthContext, SessionService } from './sessionService.js';

const contexts = new WeakMap<FastifyRequest, AuthContext>();

const unauthorized = () => new ApiHttpError(401, 'UNAUTHORIZED', 'Log in to continue.');

/**
 * The `authenticate` hook for `auth: 'user'` routes: a valid, unexpired access token for a session
 * that is not revoked, or 401. A state-changing request authenticated by the cookie must also
 * carry the session's CSRF token (403 otherwise); a Bearer token is never sent by the browser on
 * its own, so it needs none. The handler reads the result with `authContextOf`.
 */
export function createAuthenticate(sessions: SessionService): Authenticate {
  return async (request) => {
    const presented = accessTokenOf(request);
    const context = presented ? await sessions.authenticate(presented.token, presented.via) : null;
    if (!context) throw unauthorized();
    if (context.via === 'cookie' && isStateChanging(request.method)) {
      const header = csrfHeaderOf(request);
      if (!header || !sameToken(header, context.session.csrfToken)) {
        throw new ApiHttpError(
          403,
          'FORBIDDEN',
          'Invalid CSRF token. Reload the page and try again.',
        );
      }
    }
    contexts.set(request, context);
  };
}

/** The session `authenticate` resolved for this request. Throws if the route had no hook. */
export function authContextOf(request: FastifyRequest): AuthContext {
  const context = contexts.get(request);
  if (!context) throw new Error('authContextOf() called on a route without authenticate');
  return context;
}
