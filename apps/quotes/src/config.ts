import { z } from 'zod';

/** The Redis `npm run infra:up` starts (infra/docker-compose.yml). */
export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

const Flag = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((value) => value === 'true' || value === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z
    .url({ protocol: /^rediss?$/, error: 'must be a redis:// or rediss:// URL' })
    .default(DEFAULT_REDIS_URL),
  SHARDS: z.coerce.number().int().min(1).max(64).default(1),
  SHARD: z.coerce.number().int().min(0).default(0),
  LEASE_TTL_MS: z.coerce.number().int().min(1_000).default(5_000),
  LEASE_RENEW_MS: z.coerce.number().int().min(100).default(2_000),
  MOCK_MARKET_ALWAYS_OPEN: Flag,
});

export type QuotesConfig = {
  production: boolean;
  /** Redis carrying the ticks to apps/api and apps/realtime. */
  redisUrl: string;
  /** How many shards the instruments are split over (`shardOf` in `@nthstock/utils`). */
  shards: number;
  /** The shard this process writes, from 0 to `shards - 1`. */
  shard: number;
  /** How long the shard's lease lasts without a renewal. */
  leaseTtlMs: number;
  /** How often the holder renews it; well inside the TTL, so one slow renewal does not lose it. */
  leaseRenewMs: number;
  /** Tick outside NSE hours, for demos (as apps/api's `MOCK_MARKET_ALWAYS_OPEN`). */
  alwaysOpen: boolean;
};

/** Reads and validates the environment; throws at startup on a bad value. */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): QuotesConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid apps/quotes environment: ${z.prettifyError(parsed.error)}`);
  }
  const { data } = parsed;
  if (data.SHARD >= data.SHARDS) {
    throw new Error(
      `Invalid apps/quotes environment: SHARD must be below SHARDS (got ${String(data.SHARD)} of ${String(data.SHARDS)})`,
    );
  }
  if (data.LEASE_RENEW_MS * 2 > data.LEASE_TTL_MS) {
    throw new Error(
      'Invalid apps/quotes environment: LEASE_RENEW_MS must be at most half of LEASE_TTL_MS',
    );
  }
  return {
    production: data.NODE_ENV === 'production',
    redisUrl: data.REDIS_URL,
    shards: data.SHARDS,
    shard: data.SHARD,
    leaseTtlMs: data.LEASE_TTL_MS,
    leaseRenewMs: data.LEASE_RENEW_MS,
    alwaysOpen: data.MOCK_MARKET_ALWAYS_OPEN,
  };
}
