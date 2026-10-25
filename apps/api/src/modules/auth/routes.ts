import { AUTH_COOKIES, CONSENT_POLICY_VERSION, type AuthErrorDetails } from '@nthstock/contracts';
import type { AuditRepo } from '../audit/index.js';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { ApiHttpError } from '../../http/apiError.js';
import type { AppDeps } from '../../deps.js';
import { registerRoute } from '../../http/registerRoute.js';
import { createAccountDeletionService } from './accountDeletionService.js';
import { createActiveSessionsService } from './activeSessionsService.js';
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
import { createTwoFactorService } from './twoFactorService.js';
import { toCurrentSession, toDevice, toSession } from './views.js';
import { DuplicateMobileError, type UserRecord, type UsersRepo } from '../users/index.js';

/**
 * The mobile's user, created on first login with the consent the mobile step recorded (NSTOCK-0228,
 * DPDP Act 2023); a racing sign-up for the same mobile reads theirs. A new mobile without consent
 * answers 400 CONSENT_REQUIRED, and an account being deleted 403 ACCOUNT_DELETED.
 */
async function findOrCreateUser(
  users: UsersRepo,
  audit: AuditRepo,
  mobile: string,
  consentVersion: string | undefined,
): Promise<UserRecord> {
  const existing = await users.findByMobile(mobile);
  if (existing) return existing;
  const deleted = await users.findDeletedByMobile(mobile);
  if (deleted) {
    throw new ApiHttpError(
      403,
      'ACCOUNT_DELETED',
      'This account is being deleted. It cannot log in until its data is erased.',
      { purgeAfter: deleted.purgeAfter.toISOString() } satisfies AuthErrorDetails,
    );
  }
  if (consentVersion !== CONSENT_POLICY_VERSION) {
    throw new ApiHttpError(
      400,
      'CONSENT_REQUIRED',
      'Agree to the terms and privacy policy to create an account.',
    );
  }
  try {
    const created = await users.create(
      { mobile },
      { purpose: 'TERMS_AND_PRIVACY', policyVersion: consentVersion },
    );
    await audit.append({
      actor: { type: 'user', userId: created.id },
      userId: created.id,
      action: 'CONSENT_GRANTED',
      orderId: null,
      outcome: 'OK',
      detail: { purpose: 'TERMS_AND_PRIVACY', policyVersion: consentVersion },
    });
    return created;
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
    // Security notifications (NSTOCK-0382): a failure is logged and never fails the sign-in.
    const notices = {
      notifier: deps.notifier,
      onError: (error: unknown, context: { event: string; userId: string }) => {
        app.log.warn({ err: error, ...context }, 'a security notification could not be stored');
      },
    };
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
      notices,
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
    const twoFactor = createTwoFactorService({
      clock: deps.clock,
      repo: deps.repos.auth,
      users: deps.repos.users,
      audit: deps.repos.audit,
      otp,
      pins,
      sessions,
      hasher: deps.pinHasher,
      notices,
    });
    const activeSessions = createActiveSessionsService({
      clock: deps.clock,
      repo: deps.repos.auth,
      sessions,
      twoFactor,
      notices,
    });
    const accountDeletion = createAccountDeletionService({
      clock: deps.clock,
      repo: deps.repos.auth,
      users: deps.repos.users,
      audit: deps.repos.audit,
      sessions,
      twoFactor,
      orders: deps.orders,
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
        const { mobile, purpose } = await otp.verify(body);
        // A step-up OTP only ever confirms a signed-in user (`stepUp`); it never logs anyone in.
        if (purpose === 'STEP_UP') {
          throw new ApiHttpError(400, 'OTP_EXPIRED', 'This OTP has expired. Request a new one.');
        }
        const user = await findOrCreateUser(
          deps.repos.users,
          deps.repos.audit,
          mobile,
          body.consentVersion,
        );
        const trusted = await pins.trustedDevice(requestCookies(request)[AUTH_COOKIES.device]);
        const deviceId = trusted?.userId === user.id ? trusted.id : null;
        // Two-factor on: 401 TOTP_REQUIRED with a challenge; the code step finishes the login.
        await twoFactor.requireCodeIfEnabled(user, 'OTP', deviceId);
        // A verified OTP proves the owner: it lifts a PIN lock, and a trusted device stays trusted.
        await pins.unlock(user.id);
        const issued = await sessions.start({
          user,
          method: 'OTP',
          userAgent: request.headers['user-agent'],
          deviceId,
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
        const { user, device } = await pins.check({
          deviceToken: requestCookies(request)[AUTH_COOKIES.device],
          pin: body.pin,
        });
        await twoFactor.requireCodeIfEnabled(user, 'PIN', device.id);
        const issued = await sessions.start({
          user,
          method: 'PIN',
          userAgent: request.headers['user-agent'],
          deviceId: device.id,
        });
        return answer(reply, issued);
      },
      authRateLimit('pinVerify'),
    );

    // ---- Step-up and two-factor (NSTOCK-0214 to NSTOCK-0216) --------------------------------

    registerRoute(
      app,
      'totpVerify',
      async ({ body, request, reply }) =>
        answer(reply, await twoFactor.verifyLogin(body, request.headers['user-agent'])),
      authRateLimit('totpVerify'),
    );

    registerRoute(
      app,
      'stepUpOtpRequest',
      ({ request }) => twoFactor.requestStepUpOtp(authContextOf(request)),
      { authenticate, ...authRateLimit('otpRequest') },
    );

    registerRoute(
      app,
      'stepUp',
      ({ body, request }) => twoFactor.stepUp(authContextOf(request), body),
      { authenticate, ...authRateLimit('stepUp') },
    );

    registerRoute(app, 'totpEnrol', ({ request }) => twoFactor.enrol(authContextOf(request)), {
      authenticate,
    });

    registerRoute(
      app,
      'totpEnrolConfirm',
      async ({ body, request }) => ({
        codes: await twoFactor.confirm(authContextOf(request), body.code),
      }),
      { authenticate, ...authRateLimit('stepUp') },
    );

    registerRoute(
      app,
      'totpDisable',
      async ({ body, request }) => {
        await twoFactor.disable(authContextOf(request), body);
        return { ok: true as const };
      },
      { authenticate, ...authRateLimit('stepUp') },
    );

    registerRoute(
      app,
      'totpRecoveryCodes',
      async ({ body, request }) => ({
        codes: await twoFactor.regenerateRecoveryCodes(authContextOf(request), body.code),
      }),
      { authenticate, ...authRateLimit('stepUp') },
    );

    // ---- Account deletion (NSTOCK-0229) -------------------------------------------------------

    registerRoute(
      app,
      'accountDelete',
      async ({ request, reply }) => {
        const purgeAfter = await accountDeletion.delete(authContextOf(request));
        clearSessionCookies(reply, { secure });
        return { purgeAfter: purgeAfter.toISOString() };
      },
      { authenticate, ...authRateLimit('stepUp') },
    );

    // ---- Active sessions (NSTOCK-0223) -------------------------------------------------------

    registerRoute(
      app,
      'sessionsList',
      async ({ request }) => ({ sessions: await activeSessions.list(authContextOf(request)) }),
      { authenticate },
    );

    registerRoute(
      app,
      'sessionRevoke',
      async ({ params, request }) => {
        await activeSessions.revoke(authContextOf(request), params.id);
        return { ok: true as const };
      },
      { authenticate, ...authRateLimit('stepUp') },
    );

    registerRoute(
      app,
      'sessionsRevokeOthers',
      async ({ request }) => ({
        revoked: await activeSessions.revokeOthers(authContextOf(request)),
      }),
      { authenticate, ...authRateLimit('stepUp') },
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
