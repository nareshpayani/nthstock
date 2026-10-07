import { AUTH_COOKIES } from '@nthstock/contracts';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { AppDeps } from '../../deps.js';
import { registerRoute } from '../../http/registerRoute.js';
import { authContextOf, createAuthenticate } from './authenticate.js';
import { createOtpService } from './otpService.js';
import { createPinService } from './pinService.js';
import {
  clearSessionCookies,
  requestCookies,
  setDeviceCookie,
  setSessionCookies,
} from './sessionCookies.js';
import { authRateLimit } from './rateLimits.js';
import { createSessionService, sessionEnded, type IssuedSession } from './sessionService.js';
import { toCurrentSession, toDevice, toSession } from './views.js';
import { DuplicateMobileError, type UserRecord, type UsersRepo } from '../users/repo.js';

/** The mobile's user, created on first login; a racing sign-up for the same mobile reads theirs. */
async function findOrCreateUser(users: UsersRepo, mobile: string): Promise<UserRecord> {
  const existing = await users.findByMobile(mobile);
  if (existing) return existing;
  try {
    return await users.create({ mobile });
  } catch (error) {
    const winner = error instanceof DuplicateMobileError ? await users.findByMobile(mobile) : null;
    if (winner) return winner;
    throw error;
  }
}

/** Auth routes (E3): OTP request and verify, sessions, PIN. */
export const authRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const otp = createOtpService({
      clock: deps.clock,
      repo: deps.repos.auth,
      users: deps.repos.users,
      audit: deps.repos.audit,
      sms: deps.sms,
      captcha: deps.captcha,
      production: deps.production,
    });
    const sessions = createSessionService({
      clock: deps.clock,
      repo: deps.repos.auth,
      users: deps.repos.users,
      secret: deps.jwtSecret,
      audit: deps.repos.audit,
      revocations: deps.sessionRevocations,
    });
    const authenticate = createAuthenticate(sessions);
    const pins = createPinService({
      clock: deps.clock,
      repo: deps.repos.auth,
      users: deps.repos.users,
      sessions,
      hasher: deps.pinHasher,
      audit: deps.repos.audit,
    });
    const secure = deps.production;

    const answer = (reply: FastifyReply, issued: IssuedSession) => {
      setSessionCookies(reply, issued, { now: deps.clock.now(), secure });
      return toSession(issued);
    };

    registerRoute(app, 'otpRequest', ({ body }) => otp.request(body), authRateLimit('otpRequest'));

    registerRoute(
      app,
      'otpVerify',
      async ({ body, request, reply }) => {
        const { mobile } = await otp.verify(body);
        const user = await findOrCreateUser(deps.repos.users, mobile);
        // A verified OTP proves the owner: it lifts a PIN lock, and a trusted device stays trusted.
        await pins.unlock(user.id);
        const trusted = await pins.trustedDevice(requestCookies(request)[AUTH_COOKIES.device]);
        const issued = await sessions.start({
          user,
          method: 'OTP',
          userAgent: request.headers['user-agent'],
          deviceId: trusted?.userId === user.id ? trusted.id : null,
        });
        return answer(reply, issued);
      },
      authRateLimit('otpVerify'),
    );

    registerRoute(
      app,
      'pinSet',
      async ({ body, request, reply }) => {
        const trusted = await pins.set(authContextOf(request), body.pin);
        setDeviceCookie(reply, trusted, { now: deps.clock.now(), secure });
        return { device: toDevice(trusted.device, trusted.device.id) };
      },
      { authenticate, ...authRateLimit('pinSet') },
    );

    registerRoute(
      app,
      'pinVerify',
      async ({ body, request, reply }) => {
        const issued = await pins.verify({
          deviceToken: requestCookies(request)[AUTH_COOKIES.device],
          pin: body.pin,
          userAgent: request.headers['user-agent'],
        });
        return answer(reply, issued);
      },
      authRateLimit('pinVerify'),
    );

    registerRoute(
      app,
      'sessionRefresh',
      async ({ request, reply }) => {
        const token = requestCookies(request)[AUTH_COOKIES.refresh];
        try {
          if (!token) throw sessionEnded();
          return answer(reply, await sessions.refresh(token));
        } catch (error) {
          // A failed refresh leaves nothing behind that the client could retry with.
          clearSessionCookies(reply, { secure });
          throw error;
        }
      },
      authRateLimit('sessionRefresh'),
    );

    registerRoute(app, 'sessionGet', ({ request }) => toCurrentSession(authContextOf(request)), {
      authenticate,
    });

    registerRoute(
      app,
      'logout',
      async ({ request, reply }) => {
        await sessions.logout(authContextOf(request));
        clearSessionCookies(reply, { secure });
        return { ok: true as const };
      },
      { authenticate },
    );
  };
