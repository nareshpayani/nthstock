import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../../deps.js';
import { registerRoute } from '../../http/registerRoute.js';
import { createOtpService } from './otpService.js';

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

    registerRoute(app, 'otpRequest', ({ body }) => otp.request(body));
  };
