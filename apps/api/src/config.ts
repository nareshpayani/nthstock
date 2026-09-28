import { z } from 'zod';

const Flag = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((value) => value === 'true' || value === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  HOST: z.string().min(1).default('0.0.0.0'),
  MOCK_MARKET_ALWAYS_OPEN: Flag,
  ENABLE_TEST_CONTROLS: Flag,
  DEMO_SEED: Flag,
  JWT_SECRET: z.string().optional(),
  REDIS_URL: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null))
    .pipe(
      z.url({ protocol: /^rediss?$/, error: 'must be a redis:// or rediss:// URL' }).nullable(),
    ),
  DATABASE_URL: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null))
    .pipe(
      z
        .url({
          protocol: /^postgres(ql)?$/,
          error: 'must be a postgres:// or postgresql:// URL',
        })
        .nullable(),
    ),
  PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
});

export type ApiConfig = {
  /** `NODE_ENV=production`: random OTPs, no dev OTP or dev CAPTCHA. */
  production: boolean;
  port: number;
  host: string;
  /** Tick the mock market outside NSE hours (documented in `.env.example`). */
  mockMarketAlwaysOpen: boolean;
  /** `JWT_SECRET`, the access-token key; unset outside production means an ephemeral dev key. */
  jwtSecret: string | undefined;
  /** Redis for publishing ticks to apps/realtime; null (blank) serves REST only. */
  redisUrl: string | null;
  /**
   * `DATABASE_URL`, the PostgreSQL connection as the DML-only `nthstock_app` role (ADR 0007);
   * null when blank. Migrations use `DATABASE_MIGRATION_URL` instead (`npm run db:migrate`).
   */
  databaseUrl: string | null;
  /** `PG_POOL_MAX`: connections in this process's one `pg` Pool (default 10). */
  pgPoolMax: number;
  /**
   * `ENABLE_TEST_CONTROLS=true` with `NODE_ENV=test`: registers the `/v1/__test` clock and price
   * routes for E2E suites (T-162). Off by default; refused in any other NODE_ENV.
   */
  testControls: boolean;
  /**
   * `DEMO_SEED=true` (`npm run seed:demo`, T-174): load the demo watchlists and paper account for
   * the demo user at start-up. Refused in production.
   */
  demoSeed: boolean;
};

/** Reads and validates the environment; throws at startup on a bad value. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): ApiConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid apps/api environment: ${z.prettifyError(parsed.error)}`);
  }
  const production = parsed.data.NODE_ENV === 'production';
  if (production && !parsed.data.JWT_SECRET?.trim()) {
    throw new Error('Invalid apps/api environment: JWT_SECRET must be set in production');
  }
  if (parsed.data.ENABLE_TEST_CONTROLS && parsed.data.NODE_ENV !== 'test') {
    throw new Error(
      `Invalid apps/api environment: ENABLE_TEST_CONTROLS needs NODE_ENV=test (got ${parsed.data.NODE_ENV}); the test routes never run in development or production`,
    );
  }
  if (production && parsed.data.DEMO_SEED) {
    throw new Error('Invalid apps/api environment: DEMO_SEED is for local demos, not production');
  }
  return {
    production,
    port: parsed.data.PORT,
    host: parsed.data.HOST,
    mockMarketAlwaysOpen: parsed.data.MOCK_MARKET_ALWAYS_OPEN,
    jwtSecret: parsed.data.JWT_SECRET,
    redisUrl: parsed.data.REDIS_URL,
    databaseUrl: parsed.data.DATABASE_URL,
    pgPoolMax: parsed.data.PG_POOL_MAX,
    testControls: parsed.data.ENABLE_TEST_CONTROLS,
    demoSeed: parsed.data.DEMO_SEED,
  };
}
