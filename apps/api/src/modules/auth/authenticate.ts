import type { FastifyRequest } from 'fastify';
import { ApiHttpError } from '../../http/apiError.js';
import type { Authenticate } from '../../http/registerRoute.js';
import { accessTokenOf } from './sessionCookies.js';
import type { AuthContext, SessionService } from './sessionService.js';

const contexts = new WeakMap<FastifyRequest, AuthContext>();

const unauthorized = () => new ApiHttpError(401, 'UNAUTHORIZED', 'Log in to continue.');

/**
 * The `authenticate` hook for `auth: 'user'` routes: a valid, unexpired access token for a session
 * that is not revoked, or 401. The handler reads the result with `authContextOf`.
 */
export function createAuthenticate(sessions: SessionService): Authenticate {
  return async (request) => {
    const token = accessTokenOf(request);
    const context = token ? await sessions.authenticate(token) : null;
    if (!context) throw unauthorized();
    contexts.set(request, context);
  };
}

/** The session `authenticate` resolved for this request. Throws if the route had no hook. */
export function authContextOf(request: FastifyRequest): AuthContext {
  const context = contexts.get(request);
  if (!context) throw new Error('authContextOf() called on a route without authenticate');
  return context;
}
