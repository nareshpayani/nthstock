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
import { createSessionService, sessionEnded, type IssuedSession } from './sessionService.js';
import { toCurrentSession, toDevice, toSession } from './views.js';

/** Auth routes (E3): OTP request and verify, sessions, PIN. */
export const authRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const otp = createOtpService({
      clock: deps.clock,
      repo: deps.repos.auth,
      sms: deps.sms,
      captcha: deps.captcha,
      production: deps.production,
    });
    const sessions = createSessionService({
      clock: deps.clock,
      repo: deps.repos.auth,
      users: deps.repos.users,
      secret: deps.jwtSecret,
    });
    const authenticate = createAuthenticate(sessions);
    const pins = createPinService({
      clock: deps.clock,
      repo: deps.repos.auth,
      users: deps.repos.users,
      sessions,
      hasher: deps.pinHasher,
    });
    const secure = deps.production;

    const answer = (reply: FastifyReply, issued: IssuedSession) => {
      setSessionCookies(reply, issued, { now: deps.clock.now(), secure });
      return toSession(issued);
    };

    registerRoute(app, 'otpRequest', ({ body }) => otp.request(body));

    registerRoute(app, 'otpVerify', async ({ body, request, reply }) => {
      const { mobile } = await otp.verify(body);
      const user =
        (await deps.repos.users.findByMobile(mobile)) ??
        (await deps.repos.users.create({ mobile }));
      // A verified OTP proves the owner: it lifts a PIN lock, and a trusted device stays trusted.
      await pins.unlock(user.id);
      const trusted = await pins.trustedDevice(requestCookies(request)[AUTH_COOKIES.device]);
      const issued = await sessions.start({
        user,
        userAgent: request.headers['user-agent'],
        deviceId: trusted?.userId === user.id ? trusted.id : null,
      });
      return answer(reply, issued);
    });

    registerRoute(
      app,
      'pinSet',
      async ({ body, request, reply }) => {
        const trusted = await pins.set(authContextOf(request), body.pin);
        setDeviceCookie(reply, trusted, { now: deps.clock.now(), secure });
        return { device: toDevice(trusted.device, trusted.device.id) };
      },
      { authenticate },
    );

    registerRoute(app, 'pinVerify', async ({ body, request, reply }) => {
      const issued = await pins.verify({
        deviceToken: requestCookies(request)[AUTH_COOKIES.device],
        pin: body.pin,
        userAgent: request.headers['user-agent'],
      });
      return answer(reply, issued);
    });

    registerRoute(app, 'sessionRefresh', async ({ request, reply }) => {
      const token = requestCookies(request)[AUTH_COOKIES.refresh];
      try {
        if (!token) throw sessionEnded();
        return answer(reply, await sessions.refresh(token));
      } catch (error) {
        // A failed refresh leaves nothing behind that the client could retry with.
        clearSessionCookies(reply, { secure });
        throw error;
      }
    });

    registerRoute(app, 'sessionGet', ({ request }) => toCurrentSession(authContextOf(request)), {
      authenticate,
    });

    registerRoute(
      app,
      'logout',
      async ({ request, reply }) => {
        await sessions.revoke(authContextOf(request).session.id);
        clearSessionCookies(reply, { secure });
        return { ok: true as const };
      },
      { authenticate },
    );
  };
