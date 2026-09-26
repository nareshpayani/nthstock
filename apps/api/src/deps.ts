import { MockMarketDataAdapter, type MarketDataAdapter } from '@nthstock/marketData';
import { systemClock, type Clock } from '@nthstock/utils';
import { createMockCaptchaVerifier, type CaptchaVerifier } from './modules/auth/captcha.js';
import { resolveJwtSecret } from './modules/auth/jwtSecret.js';
import { createArgon2PinHasher, type PinHasher } from './modules/auth/pinHasher.js';
import { createMemoryAuthRepo, type AuthRepo } from './modules/auth/repo.js';
import {
  createMockSmsProvider,
  type SmsLog,
  type SmsProvider,
} from './modules/auth/smsProvider.js';
import { createMemoryUsersRepo, type UsersRepo } from './modules/users/repo.js';

/** Every module's storage seam. In-memory in the mock phase (ADR 0004 §3). */
export type Repos = {
  users: UsersRepo;
  auth: AuthRepo;
};

/** What modules get injected instead of reaching for globals: time, storage and market data. */
export type AppDeps = {
  clock: Clock;
  repos: Repos;
  /** The one market data adapter for this process, created at boot (T-061). */
  market: MarketDataAdapter;
  /** `NODE_ENV=production`: random OTPs, no dev OTP or dev CAPTCHA, Secure cookies. */
  production: boolean;
  sms: SmsProvider;
  captcha: CaptchaVerifier;
  /** HS256 key for access tokens (JWT_SECRET; see `resolveJwtSecret`). */
  jwtSecret: Uint8Array;
  /** Argon2id PIN hashing. */
  pinHasher: PinHasher;
  /** Releases what `createDeps` created itself (the adapter's timers). Injected parts are left alone. */
  dispose(): void;
};

export type DepsOverrides = {
  clock?: Clock;
  repos?: Partial<Repos>;
  /** Use this adapter instead of building a MockMarketDataAdapter (tests share one). */
  market?: MarketDataAdapter;
  /** `MOCK_MARKET_ALWAYS_OPEN`: let the mock market tick outside NSE hours. */
  marketAlwaysOpen?: boolean;
  production?: boolean;
  sms?: SmsProvider;
  /** Where the default mock SMS provider writes its dev log line; default: nowhere. */
  smsLog?: SmsLog;
  captcha?: CaptchaVerifier;
  /** Left out: a random per-process key outside production; production must pass one. */
  jwtSecret?: Uint8Array;
  pinHasher?: PinHasher;
};

/** Builds a fresh set of dependencies; each app (and each test app) gets its own in-memory state. */
export function createDeps(overrides: DepsOverrides = {}): AppDeps {
  const clock = overrides.clock ?? systemClock;
  const market =
    overrides.market ??
    new MockMarketDataAdapter({ clock, alwaysOpen: overrides.marketAlwaysOpen ?? false });
  const owned = overrides.market ? null : market;
  const production = overrides.production ?? false;
  return {
    clock,
    repos: {
      users: overrides.repos?.users ?? createMemoryUsersRepo({ clock }),
      auth: overrides.repos?.auth ?? createMemoryAuthRepo(),
    },
    market,
    production,
    sms:
      overrides.sms ??
      createMockSmsProvider({ log: overrides.smsLog ?? (() => undefined), production }),
    captcha: overrides.captcha ?? createMockCaptchaVerifier({ production }),
    jwtSecret: overrides.jwtSecret ?? resolveJwtSecret({ value: undefined, production }),
    pinHasher: overrides.pinHasher ?? createArgon2PinHasher(),
    dispose: () => owned?.dispose(),
  };
}

/** Restores every repo to its seeded state. */
export async function resetRepos(repos: Repos): Promise<void> {
  await Promise.all(Object.values(repos).map((repo) => repo.reset()));
}
