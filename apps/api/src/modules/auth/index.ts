// Public API of the auth module: the routes, the authenticate hook other modules' routes use, and
// the storage and provider factories the app wiring (deps.ts) composes. Other modules and the app
// wiring import it only through this file; tests may import internals.
export { authContextOf, createAuthenticate } from './authenticate.js';
export { createMockCaptchaVerifier, type CaptchaVerifier } from './captcha.js';
export { resolveJwtSecret } from './jwtSecret.js';
export { createPgAuthRepo } from './pgRepo.js';
export { createArgon2PinHasher, type PinHasher } from './pinHasher.js';
export { createRedisOtpStore } from './redisOtpStore.js';
export { createMemoryAuthRepo, createMemoryOtpStore, type AuthRepo } from './repo.js';
export { authRoutes } from './routes.js';
export {
  createMemorySessionRevocations,
  createRedisSessionRevocations,
  type SessionRevocations,
} from './sessionRevocations.js';
export { createSessionService, type AuthContext, type SessionService } from './sessionService.js';
export { createMockSmsProvider, type SmsLog, type SmsProvider } from './smsProvider.js';
