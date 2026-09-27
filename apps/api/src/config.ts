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
  JWT_SECRET: z.string().optional(),
  REDIS_URL: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null))
    .pipe(
      z.url({ protocol: /^rediss?$/, error: 'must be a redis:// or rediss:// URL' }).nullable(),
    ),
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
   * `ENABLE_TEST_CONTROLS=true` with `NODE_ENV=test`: registers the `/v1/__test` clock and price
   * routes for E2E suites (T-162). Off by default; refused in any other NODE_ENV.
   */
  testControls: boolean;
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
  return {
    production,
    port: parsed.data.PORT,
    host: parsed.data.HOST,
    mockMarketAlwaysOpen: parsed.data.MOCK_MARKET_ALWAYS_OPEN,
    jwtSecret: parsed.data.JWT_SECRET,
    redisUrl: parsed.data.REDIS_URL,
    testControls: parsed.data.ENABLE_TEST_CONTROLS,
  };
}
