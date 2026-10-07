import { MockMarketDataAdapter, type MarketDataAdapter } from '@nthstock/marketData';
import type { Redis } from 'ioredis';
import { systemClock, type Clock } from '@nthstock/utils';
import type { DbDriver } from './config.js';
import { createDatabase, type Database } from './db/client.js';
import { createPiiCrypto, resolvePiiKeys, type PiiKeys } from './db/crypto.js';
import { createMockCaptchaVerifier, type CaptchaVerifier } from './modules/auth/captcha.js';
import { resolveJwtSecret } from './modules/auth/jwtSecret.js';
import { createArgon2PinHasher, type PinHasher } from './modules/auth/pinHasher.js';
import { createPgAuthRepo } from './modules/auth/pgRepo.js';
import { createRedisOtpStore } from './modules/auth/redisOtpStore.js';
import {
  createMemorySessionRevocations,
  createRedisSessionRevocations,
  type SessionRevocations,
} from './modules/auth/sessionRevocations.js';
import { createMemoryAuthRepo, createMemoryOtpStore, type AuthRepo } from './modules/auth/repo.js';
import {
  createMockSmsProvider,
  type SmsLog,
  type SmsProvider,
} from './modules/auth/smsProvider.js';
import { createPgAuditRepo } from './modules/audit/pgRepo.js';
import { createMemoryAuditRepo, type AuditRepo } from './modules/audit/repo.js';
import { createMemoryOrdersRepo, type OrdersRepo } from './modules/orders/repo.js';
import { createOrderService, type OrderService } from './modules/orders/service.js';
import { createPgUsersRepo } from './modules/users/pgRepo.js';
import { createMemoryUsersRepo, type UsersRepo } from './modules/users/repo.js';
import { createPgWatchlistsRepo } from './modules/watchlists/pgRepo.js';
import { createMemoryWatchlistsRepo, type WatchlistsRepo } from './modules/watchlists/repo.js';

/**
 * Every module's storage seam (ADR 0004 §3). Each module's Postgres repo (`pgRepo.ts`) takes over
 * under `DB_DRIVER=postgres` as it lands (ADR 0007); so far the audit log (T-187), users
 * (T-190), auth devices, PINs and sessions (T-191, T-192), with OTPs in Redis (T-193), and
 * watchlists (T-198). The rest are in memory under both drivers.
 */
export type Repos = {
  users: UsersRepo;
  auth: AuthRepo;
  watchlists: WatchlistsRepo;
  /** Paper accounts: one engine per user (T-131). */
  orders: OrdersRepo;
  /** The append-only audit log. */
  audit: AuditRepo;
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
  /** Paper orders and funds for every user, fed by `market` ticks (T-131); one per process. */
  orders: OrderService;
  /** `DB_DRIVER` (T-182): `memory` for unit tests, `postgres` for `npm run dev:api` and E2E. */
  dbDriver: DbDriver;
  /** The process's Postgres pool under `DB_DRIVER=postgres`; null on the memory driver. */
  database: Database | null;
  /**
   * Session revocations shared by every instance (T-194): the Redis cache and
   * `auth:sessionRevoked` event under `DB_DRIVER=postgres` with Redis, else in process.
   */
  sessionRevocations: SessionRevocations;
  /**
   * Releases what `createDeps` created itself (the orders desk's subscriptions, the adapter's
   * timers, the Postgres pool). Injected parts are left alone.
   */
  dispose(): Promise<void>;
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
  /** Ids for orders and ledger entries (tests); default random. */
  newOrderId?: () => string;
  /** `DB_DRIVER`; default `memory`. `postgres` needs `databaseUrl` or `database`. */
  dbDriver?: DbDriver;
  /** `DATABASE_URL` (the nthstock_app role) for the pool `postgres` opens. */
  databaseUrl?: string;
  /** `PG_POOL_MAX` for that pool. */
  pgPoolMax?: number;
  /** Use this Postgres connection instead of opening one (tests); the caller closes it. */
  database?: Database;
  /** Where the pool reports errors on idle connections; default: nowhere. */
  onDatabaseError?: (error: Error) => void;
  /**
   * Redis for short-lived auth state under `DB_DRIVER=postgres` (ADR 0007): OTP challenges and the
   * resend throttle (T-193), and the session-revocation cache and event (T-194). Left out, that
   * state stays in this process. The caller owns the client.
   */
  redis?: Redis;
  /** Namespace of the keys apps/api writes to `redis`; default `nthstock:` (tests use their own). */
  redisKeyPrefix?: string;
  /**
   * PII column keys for the Postgres repos (`PII_ENC_KEYS`, `PII_HMAC_KEY`; T-189). Left out, the
   * development keys, which production refuses.
   */
  piiKeys?: PiiKeys;
  /** Where a failed background audit write (fills, fund movements) is reported; default stderr. */
  onAuditError?: (error: Error) => void;
};

function openDatabase(overrides: DepsOverrides, driver: DbDriver): Database | null {
  if (driver === 'memory') return null;
  if (overrides.database) return overrides.database;
  if (!overrides.databaseUrl) {
    throw new Error('DB_DRIVER=postgres needs a DATABASE_URL');
  }
  return createDatabase({
    url: overrides.databaseUrl,
    ...(overrides.pgPoolMax === undefined ? {} : { poolMax: overrides.pgPoolMax }),
    ...(overrides.onDatabaseError ? { onIdleError: overrides.onDatabaseError } : {}),
  });
}

/** Builds a fresh set of dependencies; each app (and each test app) gets its own in-memory state. */
export function createDeps(overrides: DepsOverrides = {}): AppDeps {
  const clock = overrides.clock ?? systemClock;
  const market =
    overrides.market ??
    new MockMarketDataAdapter({ clock, alwaysOpen: overrides.marketAlwaysOpen ?? false });
  const owned = overrides.market ? null : market;
  const production = overrides.production ?? false;
  const dbDriver = overrides.dbDriver ?? (overrides.database ? 'postgres' : 'memory');
  const database = openDatabase(overrides, dbDriver);
  const ownedDatabase = overrides.database ? null : database;
  const pii = database
    ? createPiiCrypto(
        overrides.piiKeys ?? resolvePiiKeys({ encKeys: undefined, hmacKey: undefined, production }),
      )
    : null;
  const redisState = database && overrides.redis ? overrides.redis : null;
  const redisPrefix = overrides.redisKeyPrefix ? { prefix: overrides.redisKeyPrefix } : {};
  const repos: Repos = {
    users:
      overrides.repos?.users ??
      (database && pii
        ? createPgUsersRepo({ database, clock, pii })
        : createMemoryUsersRepo({ clock })),
    auth:
      overrides.repos?.auth ??
      (database && pii
        ? createPgAuthRepo({
            database,
            clock,
            otp: redisState
              ? createRedisOtpStore({ redis: redisState, pii, ...redisPrefix })
              : createMemoryOtpStore(),
          })
        : createMemoryAuthRepo()),
    watchlists:
      overrides.repos?.watchlists ??
      (database ? createPgWatchlistsRepo({ database }) : createMemoryWatchlistsRepo()),
    orders: overrides.repos?.orders ?? createMemoryOrdersRepo(),
    audit:
      overrides.repos?.audit ??
      (database ? createPgAuditRepo({ database, clock }) : createMemoryAuditRepo({ clock })),
  };
  const orders = createOrderService({
    clock,
    market,
    repo: repos.orders,
    audit: repos.audit,
    ...(overrides.onAuditError ? { onAuditError: overrides.onAuditError } : {}),
    ...(overrides.newOrderId ? { newId: overrides.newOrderId } : {}),
  });
  return {
    clock,
    repos,
    market,
    production,
    sms:
      overrides.sms ??
      createMockSmsProvider({ log: overrides.smsLog ?? (() => undefined), production }),
    captcha: overrides.captcha ?? createMockCaptchaVerifier({ production }),
    jwtSecret: overrides.jwtSecret ?? resolveJwtSecret({ value: undefined, production }),
    pinHasher: overrides.pinHasher ?? createArgon2PinHasher(),
    orders,
    dbDriver,
    database,
    sessionRevocations: redisState
      ? createRedisSessionRevocations({
          redis: redisState,
          ...(overrides.redisKeyPrefix ? { namespace: overrides.redisKeyPrefix } : {}),
        })
      : createMemorySessionRevocations(),
    dispose: async () => {
      // Audit entries still queued are written before the pool closes.
      await orders.flushAudit();
      orders.dispose();
      owned?.dispose();
      await ownedDatabase?.close();
    },
  };
}

/** Restores every repo to its seeded state. */
export async function resetRepos(repos: Repos): Promise<void> {
  await Promise.all(Object.values(repos).map((repo) => repo.reset()));
}
