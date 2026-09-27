import { z } from 'zod';

/** The Redis `npm run infra:up` starts (infra/docker-compose.yml). */
export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

const Flag = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((value) => value === 'true' || value === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  JWT_SECRET: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8081),
  HOST: z.string().min(1).default('0.0.0.0'),
  REDIS_URL: z
    .url({ protocol: /^rediss?$/, error: 'must be a redis:// or rediss:// URL' })
    .default(DEFAULT_REDIS_URL),
  ENABLE_TEST_CONTROLS: Flag,
});

export type RealtimeConfig = {
  production: boolean;
  /** `JWT_SECRET`, shared with apps/api; required in production. */
  jwtSecret: string | undefined;
  port: number;
  host: string;
  /** Redis carrying ticks from apps/api (ADR 0004 §4). */
  redisUrl: string;
  /**
   * `ENABLE_TEST_CONTROLS=true` with `NODE_ENV=test`: registers `POST /v1/__test/clock` for E2E
   * suites (T-162), so access tokens apps/api issues on its test clock verify here. Off by
   * default; refused in any other NODE_ENV.
   */
  testControls: boolean;
};

/** Reads and validates the environment; throws at startup on a bad value. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): RealtimeConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid apps/realtime environment: ${z.prettifyError(parsed.error)}`);
  }
  const production = parsed.data.NODE_ENV === 'production';
  if (production && !parsed.data.JWT_SECRET?.trim()) {
    throw new Error('Invalid apps/realtime environment: JWT_SECRET must be set in production');
  }
  if (parsed.data.ENABLE_TEST_CONTROLS && parsed.data.NODE_ENV !== 'test') {
    throw new Error(
      `Invalid apps/realtime environment: ENABLE_TEST_CONTROLS needs NODE_ENV=test (got ${parsed.data.NODE_ENV}); the test routes never run in development or production`,
    );
  }
  return {
    production,
    jwtSecret: parsed.data.JWT_SECRET,
    port: parsed.data.PORT,
    host: parsed.data.HOST,
    redisUrl: parsed.data.REDIS_URL,
    testControls: parsed.data.ENABLE_TEST_CONTROLS,
  };
}
